/**
 * @file ai_module.c
 * @brief AI analytics implementation
 *
 * Motion detection: absolute difference of luma planes, count pixels
 * above threshold, fire event if ratio exceeds config.motion_threshold.
 *
 * Face detection: stub - replace with OpenCV CascadeClassifier or
 * a TFLite/ONNX face detector.
 *
 * RDAS: stub - replace with eye-blink frequency analysis on driver cam.
 */

#include "ai_module.h"
#include "../logger/logger.h"
#include "../config/config_module.h"
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <math.h>

/* -------------------------------------------------------------------------
 * Motion detection - frame difference on luma
 * ------------------------------------------------------------------------- */
#define PIXEL_DIFF_THRESHOLD  20    /* Luma difference to count as changed */

static float compute_motion(const uint8_t *cur, const uint8_t *prev,
                              int width, int height)
{
    int changed = 0;
    int total   = width * height;
    for (int i = 0; i < total; i++) {
        int diff = (int)cur[i] - (int)prev[i];
        if (diff < 0) diff = -diff;
        if (diff > PIXEL_DIFF_THRESHOLD) changed++;
    }
    return (float)changed / (float)total;
}

/* -------------------------------------------------------------------------
 * Face detection stub
 * Returns 0 faces detected.
 * Replace body with OpenCV or TFLite inference.
 * ------------------------------------------------------------------------- */
static int detect_faces(const uint8_t *y, int w, int h,
                         float *confidence_out)
{
    (void)y; (void)w; (void)h;
    *confidence_out = 0.0f;
    /* TODO: integrate OpenCV Haar/DNN or TFLite face detector */
    return 0;
}

/* -------------------------------------------------------------------------
 * RDAS (Driver Alertness) stub - driver cam only
 * Returns alert level 0.0 (none) ??? 1.0 (critical)
 * ------------------------------------------------------------------------- */
static float compute_rdas(CamAiContext *cam,
                           const uint8_t *y, int w, int h)
{
    (void)cam; (void)y; (void)w; (void)h;
    /* TODO: implement eye-blink / yawn analysis */
    return 0.0f;
}

/* -------------------------------------------------------------------------
 * Process one frame
 * ------------------------------------------------------------------------- */
static void process_frame(CamAiContext *cam, AiFrame *frame)
{
    int w = frame->width;
    int h = frame->height;

    /* --- Motion detection --- */
    if (cam->prev_frame && cam->prev_width == w && cam->prev_height == h) {
        float motion = compute_motion(frame->y_plane, cam->prev_frame, w, h);

        if (motion > cam->motion_threshold) {
            LOG_DEBUG(cam->ctx,"AI","[%s] Motion %.2f%%",
                      cam->camera_name, motion * 100.0f);
            if (cam->on_event) {
                AiEvent ev = {
                    .camera_id  = cam->camera_id,
                    .type       = AI_EVENT_MOTION,
                    .confidence = motion,
                    .pts_ms     = frame->pts_ms,
                };
                snprintf(ev.metadata, sizeof(ev.metadata),
                         "{\"motion_ratio\":%.4f}", motion);
                cam->on_event(&ev, cam->event_user_data);
            }
        }
    }

    /* Update previous frame */
    if (!cam->prev_frame || cam->prev_width != w || cam->prev_height != h) {
        free(cam->prev_frame);
        cam->prev_frame  = malloc(w * h);
        cam->prev_width  = w;
        cam->prev_height = h;
    }
    if (cam->prev_frame)
        memcpy(cam->prev_frame, frame->y_plane, w * h);

    /* --- Face detection --- */
    if (cam->enable_face) {
        float conf = 0.0f;
        int nf = detect_faces(frame->y_plane, w, h, &conf);
        if (nf > 0 && cam->on_event) {
            AiEvent ev = {
                .camera_id  = cam->camera_id,
                .type       = AI_EVENT_FACE_DETECTED,
                .confidence = conf,
                .pts_ms     = frame->pts_ms,
            };
            snprintf(ev.metadata, sizeof(ev.metadata),
                     "{\"face_count\":%d}", nf);
            cam->on_event(&ev, cam->event_user_data);
        }
    }

    /* --- RDAS --- */
    if (cam->enable_rdas) {
        float alert = compute_rdas(cam, frame->y_plane, w, h);
        if (alert > 0.7f && cam->on_event) {
            AiEvent ev = {
                .camera_id  = cam->camera_id,
                .type       = AI_EVENT_RDAS_ALERT,
                .confidence = alert,
                .pts_ms     = frame->pts_ms,
            };
            snprintf(ev.metadata, sizeof(ev.metadata),
                     "{\"alert_level\":%.2f}", alert);
            cam->on_event(&ev, cam->event_user_data);
        }
    }

    /* Free frame data */
    free(frame->y_plane);
    frame->y_plane = NULL;
}

/* -------------------------------------------------------------------------
 * AI worker thread
 * ------------------------------------------------------------------------- */
static void *ai_worker_thread(void *arg)
{
    CamAiContext *cam = (CamAiContext *)arg;
    LOG_INFO(cam->ctx,"AI","[%s] AI worker started",cam->camera_name);

    while (cam->running) {
        pthread_mutex_lock(&cam->q_mutex);
        while (cam->q_tail == cam->q_head && cam->running)
            pthread_cond_wait(&cam->q_cond, &cam->q_mutex);

        if (!cam->running && cam->q_tail == cam->q_head) {
            pthread_mutex_unlock(&cam->q_mutex);
            break;
        }

        AiFrame frame = cam->queue[cam->q_tail % AI_FRAME_QUEUE_SIZE];
        cam->q_tail++;
        pthread_mutex_unlock(&cam->q_mutex);

        process_frame(cam, &frame);
    }

    /* Drain remaining frames */
    while (cam->q_tail != cam->q_head) {
        AiFrame *f = &cam->queue[cam->q_tail++ % AI_FRAME_QUEUE_SIZE];
        free(f->y_plane);
    }

    free(cam->prev_frame);
    cam->prev_frame = NULL;
    LOG_INFO(cam->ctx,"AI","[%s] AI worker stopped",cam->camera_name);
    return NULL;
}

/* -------------------------------------------------------------------------
 * Frame push callback (from StreamerModule, runs in streamer thread)
 * ------------------------------------------------------------------------- */
void ai_push_frame(int camera_id, const uint8_t *y_plane,
                   int width, int height, uint64_t pts_ms, void *user_data)
{
    AiModule *am = (AiModule *)user_data;
    if (!am) return;

    for (int i = 0; i < am->num_cams; i++) {
        CamAiContext *cam = &am->cams[i];
        if (cam->camera_id != camera_id || !cam->running) continue;

        pthread_mutex_lock(&cam->q_mutex);

        if ((cam->q_head - cam->q_tail) >= AI_FRAME_QUEUE_SIZE) {
            /* Drop oldest frame to make room */
            AiFrame *old = &cam->queue[cam->q_tail++ % AI_FRAME_QUEUE_SIZE];
            free(old->y_plane);
        }

        AiFrame *slot = &cam->queue[cam->q_head % AI_FRAME_QUEUE_SIZE];
        slot->camera_id = camera_id;
        slot->width     = width;
        slot->height    = height;
        slot->pts_ms    = pts_ms;
        slot->y_plane   = malloc(width * height);
        if (slot->y_plane)
            memcpy(slot->y_plane, y_plane, width * height);

        cam->q_head++;
        pthread_cond_signal(&cam->q_cond);
        pthread_mutex_unlock(&cam->q_mutex);
        return;
    }
}

/* -------------------------------------------------------------------------
 * Public lifecycle
 * ------------------------------------------------------------------------- */

AiModule *ai_module_create(AppContext *ctx, OnAiEvent cb, void *user_data)
{
    AiModule *am = calloc(1, sizeof(AiModule));
    if (!am) return NULL;
    am->ctx             = ctx;
    am->on_event        = cb;
    am->event_user_data = user_data;
    pthread_mutex_init(&am->mutex, NULL);
    return am;
}

MnvrResult ai_module_start(AiModule *am)
{
    if (!am || !am->ctx) return MNVR_ERR_GENERIC;
    AppContext *ctx = am->ctx;
    const SystemConfig *cfg = config_get(ctx->config);

    am->num_cams = 0;
    for (int i = 0; i < ctx->num_cameras; i++) {
        CameraInfo   *info = &ctx->cameras[i];
        CamAiContext *cam  = &am->cams[am->num_cams];
        memset(cam, 0, sizeof(CamAiContext));

        cam->ctx              = ctx;
        cam->camera_id        = info->camera_id;
        cam->on_event         = am->on_event;
        cam->event_user_data  = am->event_user_data;
        cam->motion_threshold = cfg ? cfg->motion_threshold : 0.05f;
        cam->enable_face      = cfg ? cfg->enable_face_detection : true;
        cam->enable_rdas      = cfg ? cfg->enable_rdas : false;
        strncpy(cam->camera_name, info->name, MNVR_MAX_NAME-1);

        pthread_mutex_init(&cam->q_mutex, NULL);
        pthread_cond_init(&cam->q_cond, NULL);
        cam->running = true;

        if (pthread_create(&cam->thread, NULL, ai_worker_thread, cam) != 0) {
            LOG_ERROR(ctx,"AI","Failed to start AI worker for cam %d",info->camera_id);
            cam->running = false;
            continue;
        }
        am->num_cams++;
    }
    LOG_INFO(ctx,"AI","Started AI workers for %d camera(s)", am->num_cams);
    return MNVR_OK;
}

void ai_module_stop(AiModule *am)
{
    if (!am) return;
    for (int i = 0; i < am->num_cams; i++) {
        CamAiContext *cam = &am->cams[i];
        pthread_mutex_lock(&cam->q_mutex);
        cam->running = false;
        pthread_cond_signal(&cam->q_cond);
        pthread_mutex_unlock(&cam->q_mutex);
        pthread_join(cam->thread, NULL);
        pthread_mutex_destroy(&cam->q_mutex);
        pthread_cond_destroy(&cam->q_cond);
    }
    LOG_INFO(am->ctx,"AI","All AI workers stopped");
}

void ai_module_destroy(AiModule *am)
{
    if (!am) return;
    ai_module_stop(am);
    pthread_mutex_destroy(&am->mutex);
    free(am);
}
