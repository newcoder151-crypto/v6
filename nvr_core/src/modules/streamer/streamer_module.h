/**
 * @file streamer_module.h
 * @brief Live camera re-streaming module for web application
 *
 * For each active camera, creates an RTSP re-stream that re-publishes
 * the camera's RTSP feed so multiple web clients can watch the live
 * view without each opening a direct connection to the camera.
 *
 * Architecture:
 *   Camera RTSP feed
 *       ???
 *       ???
 *   GStreamer pipeline (one per camera):
 *     rtspsrc -> rtph264depay -> h264parse
 *             -> tee
 *               ????????? queue -> rtph264pay -> udpsink  (RTSP server)
 *               ????????? queue -> appsink                (frame capture for AI)
 *       ???
 *       ???
 *   GstRTSPServer  (port 8554)
 *       ???
 *       ???
 *   Web app (via HLS or WebRTC bridge)
 *
 * HLS live view is provided by the HLS module (separate).
 * This module provides low-latency RTSP re-stream + per-frame
 * callback for the AI module.
 */

#ifndef STREAMER_MODULE_H
#define STREAMER_MODULE_H

#include "mnvr_system.h"
#include <gst/gst.h>

/* Called with each decoded YUV frame for AI processing.
 * data: I420 plane data, width?height pixels.
 * Callback must return quickly (copy data if needed). */
typedef void (*OnFrameCallback)(int camera_id,
                                 const uint8_t *y_plane,
                                 int width, int height,
                                 uint64_t pts_ms,
                                 void *user_data);

typedef struct {
    int          camera_id;
    char         camera_name[MNVR_MAX_NAME];
    char         rtsp_url[MNVR_MAX_URL];
    int          listen_port;         /* e.g. 8554 */
    char         mount_point[64];     /* e.g. /cam_1 */

    GstElement  *pipeline;
    GstElement  *rtspsrc;
    GstElement  *depay;
    GstElement  *parser;
    GstElement  *tee;
    GstElement  *decode_queue;
    GstElement  *decoder;            /* avdec_h264 */
    GstElement  *videoconvert;
    GstElement  *appsink;            /* for AI frame callback */
    GstElement  *stream_queue;
    GstElement  *rtppay;             /* rtph264pay */
    GstElement  *udpsink;

    GMainLoop   *loop;
    pthread_t    thread;
    volatile bool running;

    OnFrameCallback on_frame;
    void           *frame_user_data;

    AppContext   *ctx;
} CamStreamer;

struct StreamerModule {
    AppContext    *ctx;
    CamStreamer    cams[MNVR_MAX_CAMERAS];
    int            num_cams;
    pthread_mutex_t mutex;

    /* Shared frame callback (forwarded to AI module) */
    OnFrameCallback on_frame;
    void           *frame_user_data;
};

/* ---- Lifecycle ---- */
StreamerModule *streamer_module_create(AppContext *ctx,
                                        OnFrameCallback cb, void *user_data);
MnvrResult      streamer_module_start(StreamerModule *sm);
void            streamer_module_stop(StreamerModule *sm);
void            streamer_module_destroy(StreamerModule *sm);

/* ---- Query stream URL for a camera ---- */
const char *streamer_get_url(StreamerModule *sm, int camera_id);

#endif /* STREAMER_MODULE_H */
