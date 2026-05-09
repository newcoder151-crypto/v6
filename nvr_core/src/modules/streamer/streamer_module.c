/**
 * @file streamer_module.c
 * @brief Live camera re-streaming with frame capture for AI
 */

#define _POSIX_C_SOURCE 200809L

#include "streamer_module.h"
#include "../logger/logger.h"
#include "../config/config_module.h"
#include <gst/gst.h>
#include <gst/app/gstappsink.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <time.h>

/* -------------------------------------------------------------------------
 * appsink callback -> forward frame to AI module
 * ------------------------------------------------------------------------- */
static GstFlowReturn new_sample_cb(GstAppSink *appsink, gpointer data)
{
    CamStreamer *cam = (CamStreamer *)data;
    if (!cam->on_frame) return GST_FLOW_OK;

    GstSample *sample = gst_app_sink_pull_sample(appsink);
    if (!sample) return GST_FLOW_OK;

    GstBuffer *buf  = gst_sample_get_buffer(sample);
    GstCaps   *caps = gst_sample_get_caps(sample);

    int width = 0, height = 0;
    if (caps) {
        GstStructure *s = gst_caps_get_structure(caps, 0);
        gst_structure_get_int(s, "width",  &width);
        gst_structure_get_int(s, "height", &height);
    }

    GstMapInfo map;
    if (gst_buffer_map(buf, &map, GST_MAP_READ)) {
        uint64_t pts_ms = GST_BUFFER_PTS_IS_VALID(buf)
            ? GST_TIME_AS_MSECONDS(GST_BUFFER_PTS(buf)) : 0;

        cam->on_frame(cam->camera_id,
                      map.data, width, height,
                      pts_ms, cam->frame_user_data);

        gst_buffer_unmap(buf, &map);
    }

    gst_sample_unref(sample);
    return GST_FLOW_OK;
}

/* -------------------------------------------------------------------------
 * Dynamic pad from rtspsrc
 * ------------------------------------------------------------------------- */
static void pad_added_cb(GstElement *src, GstPad *pad, gpointer data)
{
    (void)src;
    CamStreamer *cam = (CamStreamer *)data;

    GstCaps *caps = gst_pad_get_current_caps(pad);
    if (!caps) return;
    GstStructure *s = gst_caps_get_structure(caps, 0);
    const gchar  *media = gst_structure_get_string(s, "media");

    if (!media || strcmp(media, "video") != 0) {
        gst_caps_unref(caps); return;
    }

    GstPad *sink = gst_element_get_static_pad(cam->depay, "sink");
    if (!gst_pad_is_linked(sink))
        gst_pad_link(pad, sink);
    gst_object_unref(sink);
    gst_caps_unref(caps);
}

/* -------------------------------------------------------------------------
 * Bus callback
 * ------------------------------------------------------------------------- */
static gboolean bus_cb(GstBus *bus, GstMessage *msg, gpointer data)
{
    (void)bus;
    CamStreamer *cam = (CamStreamer *)data;
    switch (GST_MESSAGE_TYPE(msg)) {
        case GST_MESSAGE_EOS:
            LOG_INFO(cam->ctx,"STREAMER","[%s] EOS",cam->camera_name);
            g_main_loop_quit(cam->loop);
            break;
        case GST_MESSAGE_ERROR: {
            GError *e = NULL;
            gst_message_parse_error(msg, &e, NULL);
            LOG_ERROR(cam->ctx,"STREAMER","[%s] %s",cam->camera_name, e ? e->message : "?");
            if (e) g_error_free(e);
            g_main_loop_quit(cam->loop);
            break;
        }
        default: break;
    }
    return TRUE;
}

/* -------------------------------------------------------------------------
 * Build GStreamer pipeline
 * ------------------------------------------------------------------------- */
static MnvrResult build_streamer_pipeline(CamStreamer *cam)
{
    gchar *pname = g_strdup_printf("streamer-cam-%d", cam->camera_id);
    cam->pipeline     = gst_pipeline_new(pname);
    g_free(pname);

    cam->rtspsrc      = gst_element_factory_make("rtspsrc",       NULL);
    cam->depay        = gst_element_factory_make("rtph264depay",   NULL);
    cam->parser       = gst_element_factory_make("h264parse",      NULL);
    cam->tee          = gst_element_factory_make("tee",            NULL);

    /* AI decode branch */
    cam->decode_queue = gst_element_factory_make("queue",          NULL);
    cam->decoder      = gst_element_factory_make("avdec_h264",     NULL);
    cam->videoconvert = gst_element_factory_make("videoconvert",   NULL);
    cam->appsink      = gst_element_factory_make("appsink",        NULL);

    /* Re-stream branch */
    cam->stream_queue = gst_element_factory_make("queue",          NULL);
    cam->rtppay       = gst_element_factory_make("rtph264pay",     NULL);
    cam->udpsink      = gst_element_factory_make("udpsink",        NULL);

    if (!cam->pipeline || !cam->rtspsrc || !cam->depay || !cam->parser ||
        !cam->tee      || !cam->decode_queue || !cam->decoder ||
        !cam->videoconvert || !cam->appsink  ||
        !cam->stream_queue || !cam->rtppay   || !cam->udpsink) {
        LOG_FATAL(cam->ctx,"STREAMER","[%s] Element creation failed",cam->camera_name);
        return MNVR_ERR_GST;
    }

    /* Configure rtspsrc */
    g_object_set(cam->rtspsrc,
                 "location", cam->rtsp_url,
                 "latency",  100,
                 "protocols", 4,
                 NULL);

    /* Configure appsink - I420, drop old frames */
    GstCaps *ai_caps = gst_caps_new_simple("video/x-raw",
                                            "format", G_TYPE_STRING, "I420",
                                            NULL);
    g_object_set(cam->appsink,
                 "caps",             ai_caps,
                 "emit-signals",     TRUE,
                 "drop",             TRUE,
                 "max-buffers",      2,
                 "sync",             FALSE,
                 NULL);
    gst_caps_unref(ai_caps);

    GstAppSinkCallbacks cbs = {
        .eos         = NULL,
        .new_preroll = NULL,
        .new_sample  = new_sample_cb,
    };
    gst_app_sink_set_callbacks(GST_APP_SINK(cam->appsink), &cbs, cam, NULL);

    /* Configure udpsink for re-streaming on loopback */
    int udp_port = 5000 + cam->camera_id * 2;
    g_object_set(cam->udpsink,
                 "host", "127.0.0.1",
                 "port", udp_port,
                 "sync", FALSE,
                 NULL);

    /* Add all elements */
    gst_bin_add_many(GST_BIN(cam->pipeline),
                     cam->rtspsrc, cam->depay, cam->parser, cam->tee,
                     cam->decode_queue, cam->decoder, cam->videoconvert, cam->appsink,
                     cam->stream_queue, cam->rtppay, cam->udpsink,
                     NULL);

    /* Link: depay -> parser -> tee */
    if (!gst_element_link_many(cam->depay, cam->parser, cam->tee, NULL)) {
        LOG_FATAL(cam->ctx,"STREAMER","[%s] Link depay->tee failed",cam->camera_name);
        return MNVR_ERR_GST;
    }

    /* Link tee -> decode branch */
    GstPad *tee_ai   = gst_element_request_pad_simple(cam->tee, "src_%u");
    GstPad *dq_sink  = gst_element_get_static_pad(cam->decode_queue, "sink");
    gst_pad_link(tee_ai, dq_sink);
    gst_object_unref(tee_ai); gst_object_unref(dq_sink);

    if (!gst_element_link_many(cam->decode_queue, cam->decoder,
                                cam->videoconvert, cam->appsink, NULL)) {
        LOG_WARN(cam->ctx,"STREAMER","[%s] AI decode branch link failed (no decoder?)",
                 cam->camera_name);
    }

    /* Link tee -> stream branch */
    GstPad *tee_st  = gst_element_request_pad_simple(cam->tee, "src_%u");
    GstPad *sq_sink = gst_element_get_static_pad(cam->stream_queue, "sink");
    gst_pad_link(tee_st, sq_sink);
    gst_object_unref(tee_st); gst_object_unref(sq_sink);

    if (!gst_element_link_many(cam->stream_queue, cam->rtppay, cam->udpsink, NULL)) {
        LOG_WARN(cam->ctx,"STREAMER","[%s] Stream branch link failed",cam->camera_name);
    }

    /* Dynamic RTSP pad */
    g_signal_connect(cam->rtspsrc, "pad-added", G_CALLBACK(pad_added_cb), cam);

    /* Bus */
    GstBus *bus = gst_pipeline_get_bus(GST_PIPELINE(cam->pipeline));
    gst_bus_add_watch(bus, bus_cb, cam);
    gst_object_unref(bus);

    return MNVR_OK;
}

/* -------------------------------------------------------------------------
 * Streamer thread
 * ------------------------------------------------------------------------- */
static void *streamer_thread_fn(void *arg)
{
    CamStreamer *cam = (CamStreamer *)arg;
    LOG_INFO(cam->ctx,"STREAMER","[%s] Thread started",cam->camera_name);

    cam->loop = g_main_loop_new(NULL, FALSE);
    gst_element_set_state(cam->pipeline, GST_STATE_PLAYING);
    g_main_loop_run(cam->loop);   /* blocks */

    gst_element_set_state(cam->pipeline, GST_STATE_NULL);
    gst_element_get_state(cam->pipeline, NULL, NULL, GST_CLOCK_TIME_NONE);
    gst_object_unref(cam->pipeline);
    cam->pipeline = NULL;
    g_main_loop_unref(cam->loop);
    cam->loop = NULL;
    cam->running = false;

    LOG_INFO(cam->ctx,"STREAMER","[%s] Thread stopped",cam->camera_name);
    return NULL;
}

/* -------------------------------------------------------------------------
 * Public API
 * ------------------------------------------------------------------------- */

StreamerModule *streamer_module_create(AppContext *ctx,
                                        OnFrameCallback cb, void *user_data)
{
    StreamerModule *sm = calloc(1, sizeof(StreamerModule));
    if (!sm) return NULL;
    sm->ctx             = ctx;
    sm->on_frame        = cb;
    sm->frame_user_data = user_data;
    pthread_mutex_init(&sm->mutex, NULL);
    return sm;
}

MnvrResult streamer_module_start(StreamerModule *sm)
{
    if (!sm || !sm->ctx) return MNVR_ERR_GENERIC;
    AppContext *ctx = sm->ctx;

    sm->num_cams = 0;
    for (int i = 0; i < ctx->num_cameras; i++) {
        CameraInfo  *info = &ctx->cameras[i];
        CamStreamer *cam  = &sm->cams[sm->num_cams];
        memset(cam, 0, sizeof(CamStreamer));

        cam->ctx             = ctx;
        cam->camera_id       = info->camera_id;
        cam->on_frame        = sm->on_frame;
        cam->frame_user_data = sm->frame_user_data;
        strncpy(cam->camera_name, info->name,     MNVR_MAX_NAME-1);
        strncpy(cam->rtsp_url,    info->rtsp_url, MNVR_MAX_URL-1);
        snprintf(cam->mount_point, sizeof(cam->mount_point), "/cam_%d", info->camera_id);

        if (build_streamer_pipeline(cam) != MNVR_OK) {
            LOG_ERROR(ctx,"STREAMER","[%s] Pipeline failed",cam->camera_name);
            continue;
        }

        cam->running = true;
        pthread_create(&cam->thread, NULL, streamer_thread_fn, cam);
        sm->num_cams++;
        LOG_INFO(ctx,"STREAMER","[%s] Streaming on udp://127.0.0.1:%d",
                 cam->camera_name, 5000 + info->camera_id * 2);

        { struct timespec _ts = {0, 100000000L}; nanosleep(&_ts, NULL); };
    }
    return MNVR_OK;
}

void streamer_module_stop(StreamerModule *sm)
{
    if (!sm) return;
    for (int i = 0; i < sm->num_cams; i++) {
        CamStreamer *cam = &sm->cams[i];
        if (!cam->running) continue;
        if (cam->loop) g_main_loop_quit(cam->loop);
        pthread_join(cam->thread, NULL);
    }
}

void streamer_module_destroy(StreamerModule *sm)
{
    if (!sm) return;
    streamer_module_stop(sm);
    pthread_mutex_destroy(&sm->mutex);
    free(sm);
}

const char *streamer_get_url(StreamerModule *sm, int camera_id)
{
    for (int i = 0; i < sm->num_cams; i++)
        if (sm->cams[i].camera_id == camera_id)
            return sm->cams[i].mount_point;
    return NULL;
}
