/**
 * @file recorder.h
 * @brief Individual camera recorder management
 * 
 * Defines structures and functions for managing individual camera recorders.
 * Each recorder handles one RTSP stream with its own GStreamer pipeline,
 * configuration, and recording thread.
 */

#ifndef RECORDER_H
#define RECORDER_H

#include <gst/gst.h>
#include <pthread.h>
#include "config.h"

/**
 * @brief Camera recorder structure
 * 
 * Represents a single camera recording session with its own GStreamer pipeline,
 * configuration, and control thread. Manages RTSP stream capture and file output.
 */
typedef struct {
    /** @brief Unique camera identifier (0-based index) */
    int camera_id;
    
    /** @brief Human-readable camera name for logging */
    gchar camera_name[MAX_NAME_LEN];
    
    /** @brief GStreamer pipeline for this camera */
    GstElement *pipeline;
    
    /** @brief RTSP source element */
    GstElement *rtspsrc;
    
    /** @brief RTP H.264 depayloader */
    GstElement *depay;
    
    /** @brief H.264 parser element */
    GstElement *parser;
    
    /** @brief Queue element for buffering */
    GstElement *queue;
    
    /** @brief Splitmux sink for file segmentation */
    GstElement *splitmux;
    
    /** @brief MP4 muxer element */
    GstElement *muxer;
    
    /** @brief File sink element (non-segmented mode) */
    GstElement *filesink;
    
    /** @brief GLib main loop for this recorder */
    GMainLoop *loop;
    
    /** @brief Recording thread handle */
    pthread_t thread;
    
    /** @brief RTSP camera URL */
    gchar camera_url[MAX_PATH_LEN];
    
    /** @brief Output file path (without extension) */
    gchar output_file[MAX_PATH_LEN];
    
    /** @brief Current recording status */
    gboolean is_recording;
    
    /** @brief Stop flag for graceful shutdown */
    gboolean should_stop;
    
    /** @brief Recording configuration for this camera */
    RecordingConfig config;
} CameraRecorder;

/**
 * @brief Create a new camera recorder instance
 * 
 * Allocates and initializes a CameraRecorder structure with provided parameters.
 * Does not start the pipeline - call recorder_start() to begin recording.
 * 
 * @param[in] id Unique camera identifier
 * @param[in] name Human-readable camera name (NULL for default)
 * @param[in] rtsp_url RTSP stream URL
 * @param[in] output_file Output file path prefix (without extension)
 * @return Pointer to newly created CameraRecorder, NULL on failure
 * 
 * Called from: manager_add_camera()
 */
CameraRecorder* recorder_create(int id, const char *name, const char *rtsp_url, const char *output_file);

/**
 * @brief Start recording for a camera
 * 
 * Creates GStreamer pipeline, configures elements based on recorder config,
 * and starts recording thread. Supports both segmented and continuous recording.
 * 
 * Pipeline topology (segmented):
 * rtspsrc -> rtph264depay -> h264parse -> queue -> splitmuxsink
 * 
 * Pipeline topology (continuous):
 * rtspsrc -> rtph264depay -> h264parse -> mp4mux -> filesink
 * 
 * @param[in,out] rec Pointer to CameraRecorder to start
 * @return 0 on success, -1 on failure
 * 
 * Called from: manager_start_all()
 */
int recorder_start(CameraRecorder *rec);

/**
 * @brief Stop recording for a camera
 * 
 * Gracefully stops recording by sending EOS event, stopping pipeline,
 * joining thread, and cleaning up resources. Waits for clean shutdown.
 * 
 * @param[in,out] rec Pointer to CameraRecorder to stop
 * 
 * Called from: manager_stop_all(), recorder_destroy()
 */
void recorder_stop(CameraRecorder *rec);

/**
 * @brief Destroy camera recorder and free resources
 * 
 * Stops recording if active and frees all allocated memory.
 * After this call, the recorder pointer is invalid.
 * 
 * @param[in,out] rec Pointer to CameraRecorder to destroy
 * 
 * Called from: manager_destroy()
 */
void recorder_destroy(CameraRecorder *rec);

/**
 * @brief Recording thread function
 * 
 * Runs GLib main loop for this camera's pipeline. Executes in separate
 * pthread for concurrent multi-camera recording.
 * 
 * @param[in] arg Pointer to CameraRecorder (cast from void*)
 * @return NULL (pthread return value)
 * 
 * Called from: pthread_create() in recorder_start()
 */
void* recorder_thread(void *arg);

#endif /* RECORDER_H */
