/**
 * @file ai_module.h
 * @brief AI analytics module: motion detection, face detection, RDAS
 *
 * Receives raw I420 frames via the OnFrameCallback from StreamerModule.
 * Runs analytics in a per-camera worker thread (frame queue).
 *
 * Features:
 *   - Motion detection (frame-diff algorithm, configurable threshold)
 *   - Face detection (placeholder: integrate OpenCV / haarcascade)
 *   - RDAS (Driver Alertness System - eye blink / yawn detector)
 *   - Writes events to the events DB table via db_module
 *
 * Each camera has:
 *   - An input frame queue (ring, drops oldest when full)
 *   - One AI worker thread draining the queue
 *   - Per-frame metrics written to DB periodically
 */

#ifndef AI_MODULE_H
#define AI_MODULE_H

#include "mnvr_system.h"

#define AI_FRAME_QUEUE_SIZE   8    /* Max queued frames per camera */

typedef struct {
    uint8_t *y_plane;    /* Luma plane copy */
    int      width;
    int      height;
    uint64_t pts_ms;
    int      camera_id;
} AiFrame;

/* AI event types (mirrors events DB table) */
typedef enum {
    AI_EVENT_MOTION        = 1,
    AI_EVENT_FACE_DETECTED = 2,
    AI_EVENT_TAMPERING     = 3,
    AI_EVENT_RDAS_ALERT    = 4,
} AiEventType;

typedef struct {
    int          camera_id;
    AiEventType  type;
    float        confidence;       /* 0.0-1.0 */
    uint64_t     pts_ms;
    char         metadata[256];    /* JSON extra info */
} AiEvent;

/* Callback when an AI event is detected */
typedef void (*OnAiEvent)(const AiEvent *ev, void *user_data);

/* Per-camera AI context */
typedef struct {
    int          camera_id;
    char         camera_name[MNVR_MAX_NAME];

    /* Frame queue */
    AiFrame      queue[AI_FRAME_QUEUE_SIZE];
    volatile int q_head;
    volatile int q_tail;
    pthread_mutex_t q_mutex;
    pthread_cond_t  q_cond;

    pthread_t    thread;
    volatile bool running;

    /* State for motion detection */
    uint8_t     *prev_frame;
    int          prev_width;
    int          prev_height;

    /* Config */
    float        motion_threshold;
    bool         enable_face;
    bool         enable_rdas;

    AppContext   *ctx;
    OnAiEvent    on_event;
    void        *event_user_data;
} CamAiContext;

struct AiModule {
    AppContext     *ctx;
    CamAiContext    cams[MNVR_MAX_CAMERAS];
    int             num_cams;
    pthread_mutex_t mutex;

    OnAiEvent  on_event;
    void      *event_user_data;
};

/* ---- Lifecycle ---- */
AiModule *ai_module_create(AppContext *ctx,
                             OnAiEvent cb, void *user_data);
MnvrResult ai_module_start(AiModule *am);
void       ai_module_stop(AiModule *am);
void       ai_module_destroy(AiModule *am);

/* ---- Frame input (called from StreamerModule's OnFrameCallback) ---- */
void ai_push_frame(int camera_id, const uint8_t *y_plane,
                   int width, int height, uint64_t pts_ms, void *user_data);

#endif /* AI_MODULE_H */
