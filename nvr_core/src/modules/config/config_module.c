/**
 * @file config_module.c
 * @brief Configuration module implementation
 *
 * Two-phase config load:
 *   Phase 1 - Parse INI file (mnvr.conf) into SystemConfig.
 *   Phase 2 - Query PostgreSQL system_config and cameras tables
 *              to override / supplement INI values and populate
 *              ctx->cameras[].
 *
 * Reload (SIGHUP):
 *   Main loop calls config_reload() when dirty flag is set.
 *   Modules that care about config changes poll config_get() each
 *   iteration; critical modules (recorder) are restarted explicitly
 *   by main after a reload.
 */

#include "config_module.h"
#include "../logger/logger.h"
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <ctype.h>
#include <libpq-fe.h>

/* -------------------------------------------------------------------------
 * Defaults
 * ------------------------------------------------------------------------- */
static void apply_defaults(SystemConfig *s)
{
    strncpy(s->storage_base,          "/storage/recordings",MNVR_MAX_PATH-1);
    strncpy(s->hls_base,              "/storage/hls",       MNVR_MAX_PATH-1);
    strncpy(s->db_path,               "/etc/mnvr/mnvr.db",  MNVR_MAX_PATH-1);
    strncpy(s->log_dir,               "/var/log/mnvr",      MNVR_MAX_PATH-1);
    strncpy(s->device_name,           "MNVR-001",           MNVR_MAX_NAME-1);
    strncpy(s->time_sync_method,      "PTP",                15);
    strncpy(s->ntp_server,            "pool.ntp.org",       127);

    s->recording_retention_days = 30;
    s->segment_duration_sec     = 900;   /* 15-minute MP4 segments */
    s->segment_max_size_mb      = 2048;
    s->enable_audio             = true;
    s->enable_watermark         = true;

    s->hls_segment_sec          = MNVR_HLS_SEGMENT_SEC;
    s->hls_window_size          = MNVR_HLS_MAX_SEGMENTS;
    s->hls_delete_old_segments  = true;

    s->rtsp_server_port         = 8554;
    s->webrtc_server_port       = 8080;

    s->enable_face_detection    = true;
    s->enable_motion_detection  = true;
    s->enable_rdas              = false;
    s->motion_threshold         = 0.05f;

    s->api_port                 = 8443;
    s->api_tls_enabled          = true;

    s->health_poll_interval_sec = 10;
    s->cpu_warn_threshold       = 85.0f;
    s->mem_warn_threshold       = 90.0f;
    s->disk_warn_threshold      = 90.0f;

    s->log_min_level            = LOG_LEVEL_INFO;
    s->log_to_syslog            = false;
    s->ptp_domain               = 0;
}

/* -------------------------------------------------------------------------
 * INI parser (minimal, no external dependency)
 * ------------------------------------------------------------------------- */
static void trim(char *s)
{
    char *p = s;
    while (isspace((unsigned char)*p)) p++;
    memmove(s, p, strlen(p) + 1);
    char *e = s + strlen(s) - 1;
    while (e >= s && isspace((unsigned char)*e)) *e-- = '\0';
}

static void parse_ini(SystemConfig *s, const char *path)
{
    FILE *fp = fopen(path, "r");
    if (!fp) return;

    char line[1024];
    while (fgets(line, sizeof(line), fp)) {
        line[strcspn(line, "\r\n")] = '\0';
        if (line[0] == '#' || line[0] == '[' || line[0] == '\0') continue;

        char *eq = strchr(line, '=');
        if (!eq) continue;
        *eq = '\0';
        char *key = line;  char *val = eq + 1;
        trim(key); trim(val);

#define PARSE_STR(field, name) \
        if (strcmp(key, name) == 0) strncpy(s->field, val, sizeof(s->field)-1);
#define PARSE_INT(field, name) \
        if (strcmp(key, name) == 0) s->field = atoi(val);
#define PARSE_BOOL(field, name) \
        if (strcmp(key, name) == 0) s->field = (strcmp(val,"1")==0||strcmp(val,"true")==0);
#define PARSE_FLOAT(field, name) \
        if (strcmp(key, name) == 0) s->field = (float)atof(val);

        PARSE_STR(storage_base,          "storage_base")
        PARSE_STR(hls_base,              "hls_base")
        PARSE_STR(db_path,               "db_path")
        PARSE_STR(log_dir,               "log_dir")
        PARSE_STR(device_id,             "device_id")
        PARSE_STR(device_name,           "device_name")
        PARSE_INT(recording_retention_days, "recording_retention_days")
        PARSE_INT(segment_duration_sec,  "segment_duration_sec")
        PARSE_INT(segment_max_size_mb,   "segment_max_size_mb")
        PARSE_BOOL(enable_audio,         "enable_audio")
        PARSE_BOOL(enable_watermark,     "enable_watermark")
        PARSE_INT(hls_segment_sec,       "hls_segment_sec")
        PARSE_INT(hls_window_size,       "hls_window_size")
        PARSE_BOOL(hls_delete_old_segments, "hls_delete_old_segments")
        PARSE_INT(rtsp_server_port,      "rtsp_server_port")
        PARSE_INT(api_port,              "api_port")
        PARSE_BOOL(api_tls_enabled,      "api_tls_enabled")
        PARSE_STR(api_tls_cert,          "api_tls_cert")
        PARSE_STR(api_tls_key,           "api_tls_key")
        PARSE_BOOL(enable_face_detection,"enable_face_detection")
        PARSE_BOOL(enable_motion_detection,"enable_motion_detection")
        PARSE_BOOL(enable_rdas,          "enable_rdas")
        PARSE_FLOAT(motion_threshold,    "motion_threshold")
        PARSE_STR(time_sync_method,      "time_sync_method")
        PARSE_STR(ntp_server,            "ntp_server")
        PARSE_INT(ptp_domain,            "ptp_domain")
        PARSE_INT(health_poll_interval_sec, "health_poll_interval_sec")
        PARSE_FLOAT(cpu_warn_threshold,  "cpu_warn_threshold")
        PARSE_FLOAT(mem_warn_threshold,  "mem_warn_threshold")
        PARSE_FLOAT(disk_warn_threshold, "disk_warn_threshold")
        PARSE_BOOL(log_to_syslog,        "log_to_syslog")
    }
    fclose(fp);
}

/* -------------------------------------------------------------------------
 * PostgreSQL config overlay
 * ------------------------------------------------------------------------- */
static void load_from_db(SystemConfig *s, const char *conninfo)
{
    PGconn *conn = PQconnectdb(conninfo);
    if (!conn || PQstatus(conn) != CONNECTION_OK) {
        if (conn) PQfinish(conn);
        return;   /* DB not available yet on first boot */
    }

    PGresult *res = PQexec(conn,
        "SELECT config_key, config_value FROM system_config");

    if (PQresultStatus(res) == PGRES_TUPLES_OK) {
        int nrows = PQntuples(res);
        for (int i = 0; i < nrows; i++) {
            const char *k = PQgetvalue(res, i, 0);
            const char *v = PQgetvalue(res, i, 1);
            if (!k || !v) continue;

            if (strcmp(k,"device_id")   == 0) strncpy(s->device_id,   v, MNVR_MAX_NAME-1);
            if (strcmp(k,"device_name") == 0) strncpy(s->device_name, v, MNVR_MAX_NAME-1);
            if (strcmp(k,"storage_path")== 0) strncpy(s->storage_base,v, MNVR_MAX_PATH-1);
            if (strcmp(k,"recording_retention_days")==0) s->recording_retention_days = atoi(v);
            if (strcmp(k,"enable_audio")==0) s->enable_audio = (strcmp(v,"1")==0);
            if (strcmp(k,"enable_watermark")==0) s->enable_watermark = (strcmp(v,"1")==0);
            if (strcmp(k,"enable_face_detection")==0) s->enable_face_detection = (strcmp(v,"1")==0);
            if (strcmp(k,"rtsp_server_port")==0) s->rtsp_server_port = atoi(v);
            if (strcmp(k,"api_server_port")==0)  s->api_port = atoi(v);
            if (strcmp(k,"time_sync_method")==0) strncpy(s->time_sync_method,v,15);
            if (strcmp(k,"ntp_server")==0) strncpy(s->ntp_server,v,127);
            if (strcmp(k,"ptp_domain")==0) s->ptp_domain = atoi(v);
        }
    }
    PQclear(res);
    PQfinish(conn);
}

/* -------------------------------------------------------------------------
 * Sync final config values back to system_config DB table.
 * After config_load() resolves precedence (INI wins), this function
 * UPDATEs the DB rows so they match the running config.
 * Also logs all rows in the table for verification.
 * ------------------------------------------------------------------------- */
static void sync_config_to_db(const SystemConfig *s, const char *conninfo,
                                AppContext *ctx)
{
    PGconn *conn = PQconnectdb(conninfo);
    if (!conn || PQstatus(conn) != CONNECTION_OK) {
        if (conn) PQfinish(conn);
        return;
    }

    /* UPDATE each known config key with the final resolved value */
    char sql[512];
    const char *fmt =
        "UPDATE system_config SET config_value='%s', "
        "last_modified_at=NOW(), last_modified_by='mnvrd' "
        "WHERE config_key='%s';";

    char val_buf[64];

#define SYNC_STR(key, field) \
    snprintf(sql, sizeof(sql), fmt, (field), (key)); PQexec(conn, sql);

#define SYNC_INT(key, field) \
    snprintf(val_buf, sizeof(val_buf), "%d", (field)); \
    snprintf(sql, sizeof(sql), fmt, val_buf, (key)); PQexec(conn, sql);

#define SYNC_BOOL(key, field) \
    snprintf(sql, sizeof(sql), fmt, (field) ? "1" : "0", (key)); PQexec(conn, sql);

    SYNC_STR ("device_id",               s->device_id);
    SYNC_STR ("device_name",             s->device_name);
    SYNC_STR ("storage_path",            s->storage_base);
    SYNC_INT ("recording_retention_days", s->recording_retention_days);
    SYNC_BOOL("enable_audio",            s->enable_audio);
    SYNC_BOOL("enable_watermark",        s->enable_watermark);
    SYNC_BOOL("enable_face_detection",   s->enable_face_detection);
    SYNC_INT ("rtsp_server_port",        s->rtsp_server_port);
    SYNC_INT ("api_server_port",         s->api_port);
    SYNC_STR ("time_sync_method",        s->time_sync_method);
    SYNC_STR ("ntp_server",              s->ntp_server);
    SYNC_INT ("ptp_domain",              s->ptp_domain);

#undef SYNC_STR
#undef SYNC_INT
#undef SYNC_BOOL

    /* Now read back and display the full table */
    if (ctx) {
        LOG_INFO(ctx, "CONFIG", "=== system_config table (after sync) ===");
    }
    PGresult *res = PQexec(conn,
        "SELECT config_key, config_value, config_type, is_readonly "
        "FROM system_config ORDER BY id");

    if (PQresultStatus(res) == PGRES_TUPLES_OK) {
        int nrows = PQntuples(res);
        for (int i = 0; i < nrows; i++) {
            const char *k = PQgetvalue(res, i, 0);
            const char *v = PQgetvalue(res, i, 1);
            const char *t = PQgetvalue(res, i, 2);
            const char *ro = PQgetvalue(res, i, 3);
            if (ctx) {
                LOG_INFO(ctx, "CONFIG", "  %-28s = %-30s [%s%s]",
                         k, v, t,
                         (ro && strcmp(ro, "1") == 0) ? ",RO" : "");
            }
        }
    }
    if (ctx) {
        LOG_INFO(ctx, "CONFIG", "=== end system_config ===");
    }

    PQclear(res);
    PQfinish(conn);
}

/* -------------------------------------------------------------------------
 * Public API
 * ------------------------------------------------------------------------- */

ConfigModule *config_create(const char *ini_path, AppContext *ctx)
{
    ConfigModule *m = calloc(1, sizeof(ConfigModule));
    if (!m) return NULL;
    strncpy(m->ini_path, ini_path, MNVR_MAX_PATH - 1);
    m->ctx = ctx;
    pthread_mutex_init(&m->mutex, NULL);
    return m;
}

MnvrResult config_load(ConfigModule *m)
{
    if (!m) return MNVR_ERR_GENERIC;
    apply_defaults(&m->sys);

    /* Load order:
     *   1. Parse INI first (needed to get db_path connection string)
     *   2. Load DB system_config (provisioning defaults)
     *   3. Parse INI again (so mnvr.conf always wins over DB values)
     *   4. Sync final values back to DB (so DB always reflects running config)
     *
     * Precedence (highest to lowest):
     *   mnvr.conf  >  DB system_config  >  compiled defaults
     */
    parse_ini(&m->sys, m->ini_path);         /* 1st pass: get db_path */
    load_from_db(&m->sys, m->sys.db_path);   /* DB fills in provisioning values */
    parse_ini(&m->sys, m->ini_path);         /* 2nd pass: INI wins over DB */
    sync_config_to_db(&m->sys, m->sys.db_path, m->ctx);  /* write back to DB */

    m->dirty = false;
    return MNVR_OK;
}

MnvrResult config_reload(ConfigModule *m)
{
    pthread_mutex_lock(&m->mutex);
    MnvrResult r = config_load(m);
    pthread_mutex_unlock(&m->mutex);
    return r;
}

MnvrResult config_load_cameras(ConfigModule *m)
{
    if (!m || !m->ctx) return MNVR_ERR_GENERIC;
    AppContext *ctx = m->ctx;

    /* Connect to PostgreSQL for camera load */
    PGconn *db = PQconnectdb(m->sys.db_path);   /* db_path holds conninfo string */
    if (!db || PQstatus(db) != CONNECTION_OK) {
        LOG_WARN(ctx, "CONFIG", "Cannot connect for camera load: %s",
                 db ? PQerrorMessage(db) : "out of memory");
        if (db) PQfinish(db);
        return MNVR_ERR_DB;
    }

    char sql[512];
    snprintf(sql, sizeof(sql),
        "SELECT camera_id, camera_name, camera_type, ip_address, rtsp_url, "
        "       resolution_width, resolution_height, target_fps, video_codec, "
        "       location_description, audio_supported, ptz_supported, status, "
        "       rec_output_dir, hls_output_dir, hls_playlist_url, "
        "       username, password_hash "
        "FROM cameras WHERE status='ACTIVE' ORDER BY camera_id LIMIT %d",
        MNVR_MAX_CAMERAS);

    PGresult *pgres = PQexec(db, sql);
    if (PQresultStatus(pgres) != PGRES_TUPLES_OK) {
        LOG_WARN(ctx, "CONFIG", "Camera query failed: %s", PQresultErrorMessage(pgres));
        PQclear(pgres);
        PQfinish(db);
        return MNVR_ERR_DB;
    }

    pthread_mutex_lock(&ctx->cameras_mutex);
    ctx->num_cameras = 0;
    int nrows = PQntuples(pgres);

    for (int row = 0; row < nrows && ctx->num_cameras < MNVR_MAX_CAMERAS; row++) {
        CameraInfo *cam = &ctx->cameras[ctx->num_cameras];
        memset(cam, 0, sizeof(CameraInfo));

        cam->camera_id = atoi(PQgetvalue(pgres, row, 0));
        const char *v;
        v = PQgetvalue(pgres, row, 1); strncpy(cam->name,         v ? v : "cam",   MNVR_MAX_NAME-1);
        v = PQgetvalue(pgres, row, 3); strncpy(cam->ip_address,   v ? v : "",       63);
        v = PQgetvalue(pgres, row, 4); strncpy(cam->rtsp_url,     v ? v : "",       MNVR_MAX_URL-1);
        /* Columns 16,17 = username, password_hash (plain RTSP password stored here) */
        v = PQgetvalue(pgres, row, 16); strncpy(cam->rtsp_username, v ? v : "", MNVR_MAX_NAME-1);
        v = PQgetvalue(pgres, row, 17); strncpy(cam->rtsp_password, v ? v : "", MNVR_MAX_NAME-1);

        /* Embed credentials into RTSP URL if not already present */
        if (cam->rtsp_username[0] && cam->rtsp_password[0] &&
            strstr(cam->rtsp_url, "@") == NULL &&
            strncmp(cam->rtsp_url, "rtsp://", 7) == 0) {

            char url_with_auth[MNVR_MAX_URL];

            snprintf(url_with_auth, sizeof(url_with_auth),
                     "rtsp://%s:%s@%s",
                     cam->rtsp_username,
                     cam->rtsp_password,
                     cam->rtsp_url + 7);   /* skip rtsp:// */

            strncpy(cam->rtsp_url, url_with_auth, MNVR_MAX_URL - 1);
            cam->rtsp_url[MNVR_MAX_URL - 1] = '\0';
        }
        v = PQgetvalue(pgres, row, 5); cam->resolution_width  = v ? atoi(v) : 1920;
        v = PQgetvalue(pgres, row, 6); cam->resolution_height = v ? atoi(v) : 1080;
        v = PQgetvalue(pgres, row, 7); cam->target_fps        = v ? atoi(v) : 25;
        v = PQgetvalue(pgres, row, 8); strncpy(cam->codec,        v ? v : "H.264",  15);
        v = PQgetvalue(pgres, row, 9); strncpy(cam->location_desc,v ? v : "",       127);
        v = PQgetvalue(pgres, row,10); cam->audio_enabled  = v && strcmp(v,"t")==0;
        v = PQgetvalue(pgres, row,11); cam->ptz_supported  = v && strcmp(v,"t")==0;
        cam->state = CAM_STATE_ACTIVE;

        /* rec_output_dir: use DB value if set, else compute from config */
        v = PQgetvalue(pgres, row, 13);
        if (v && v[0])
            snprintf(cam->rec_output_dir, MNVR_MAX_PATH, "%.511s", v);
        else
            snprintf(cam->rec_output_dir, MNVR_MAX_PATH, "%.480s/cam_%d",
                     m->sys.storage_base, cam->camera_id);

        /* hls_output_dir: use DB value if set, else compute from config */
        v = PQgetvalue(pgres, row, 14);
        if (v && v[0])
            snprintf(cam->hls_output_dir, MNVR_MAX_PATH, "%.511s", v);
        else
            snprintf(cam->hls_output_dir, MNVR_MAX_PATH, "%.480s/cam_%d",
                     m->sys.hls_base, cam->camera_id);

        /* stream_url always computed; hls_playlist_url stored in DB only */
        snprintf(cam->stream_url, MNVR_MAX_URL, "rtsp://127.0.0.1:%d/cam_%d",
                 m->sys.rtsp_server_port, cam->camera_id);

        ctx->num_cameras++;
    }

    pthread_mutex_unlock(&ctx->cameras_mutex);
    PQclear(pgres);
    PQfinish(db);

    LOG_INFO(ctx, "CONFIG", "Loaded %d active cameras from DB", ctx->num_cameras);
    return MNVR_OK;
}

const SystemConfig *config_get(ConfigModule *m)
{
    return m ? &m->sys : NULL;
}

void config_mark_dirty(ConfigModule *m)
{
    if (m) m->dirty = true;
}

void config_destroy(ConfigModule *m)
{
    if (!m) return;
    pthread_mutex_destroy(&m->mutex);
    free(m);
}
