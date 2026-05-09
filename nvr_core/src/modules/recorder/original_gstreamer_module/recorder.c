/**
 * @file recorder.c
 * @brief Individual camera recorder implementation
 * 
 * Implements camera recorder lifecycle management including creation,
 * GStreamer pipeline construction, recording control, and cleanup.
 * Each recorder runs in its own thread with independent pipeline.
 * 
 * Supports two recording modes:
 * 1. Segmented: Uses splitmuxsink for automatic file segmentation
 * 2. Continuous: Single file output with optional MP4 fragmentation
 */

#include "recorder.h"
#include "callbacks.h"
#include <unistd.h>

/**
 * @brief Pad probe that drops buffers without a valid PTS.
 *
 * Some RTSP cameras occasionally emit frames without presentation
 * timestamps.  mp4mux cannot mux these and will error out.  This
 * probe silently drops the offending buffer so recording continues.
 */
static GstPadProbeReturn drop_no_pts_probe(GstPad *pad,
                                            GstPadProbeInfo *info,
                                            gpointer user_data)
{
    (void)pad;
    (void)user_data;
    GstBuffer *buf = GST_PAD_PROBE_INFO_BUFFER(info);
    if (buf && !GST_BUFFER_PTS_IS_VALID(buf)) {
        return GST_PAD_PROBE_DROP;   /* silently discard this buffer */
    }
    return GST_PAD_PROBE_OK;
}

/**
 * @brief Recording thread function
 * 
 * Runs GLib main loop for this camera's GStreamer pipeline.
 * Executes in separate pthread created by recorder_start() to allow
 * concurrent multi-camera recording without blocking.
 * 
 * The main loop processes GStreamer bus messages, callbacks, and
 * handles pipeline events until g_main_loop_quit() is called
 * (typically from bus_call on EOS or ERROR).
 * 
 * @param[in] arg Pointer to CameraRecorder (cast from void* for pthread)
 * @return NULL (pthread return value, unused)
 * 
 * Called from: pthread_create() in recorder_start()
 */
void* recorder_thread(void *arg) {
    CameraRecorder *rec = (CameraRecorder *)arg;
    g_print("[%s] Recording thread started\n", rec->camera_name);
    if (rec->loop) {
        g_main_loop_run(rec->loop);
    }
    g_print("[%s] Recording thread finished\n", rec->camera_name);
    return NULL;
}

/**
 * @brief Create a new camera recorder instance
 * 
 * Allocates and initializes CameraRecorder structure with provided
 * parameters. Initializes configuration with defaults but does not
 * create pipeline or start recording.
 * 
 * Initialization:
 * - Allocates zero-initialized structure
 * - Copies identification and path strings
 * - Sets initial state flags (not recording)
 * - Initializes config with defaults
 * 
 * Pipeline creation happens later in recorder_start().
 * 
 * @param[in] id Unique camera identifier (0-based index)
 * @param[in] name Human-readable camera name (NULL defaults to "Camera")
 * @param[in] rtsp_url RTSP stream URL (e.g., "rtsp://user:pass@host/stream")
 * @param[in] output_file Output file path prefix without extension
 * @return Pointer to newly created CameraRecorder, never NULL
 * 
 * Called from: manager_add_camera()
 */
CameraRecorder* recorder_create(int id, const char *name, const char *rtsp_url, const char *output_file) {
    CameraRecorder *rec = g_malloc0(sizeof(CameraRecorder));
    
    rec->camera_id = id;
    g_strlcpy(rec->camera_name, name ? name : "Camera", sizeof(rec->camera_name));
    g_strlcpy(rec->camera_url, rtsp_url, sizeof(rec->camera_url));
    g_strlcpy(rec->output_file, output_file, sizeof(rec->output_file));
    rec->is_recording = FALSE;
    rec->should_stop = FALSE;
    
    config_init_defaults(&rec->config);
    
    return rec;
}

/**
 * @brief Start recording for a camera
 * 
 * Creates and configures GStreamer pipeline based on recorder configuration,
 * sets up callbacks, and starts recording thread. Supports both segmented
 * and continuous recording modes.
 * 
 * Pipeline construction:
 * 1. Create pipeline and basic elements (rtspsrc, depay, parser)
 * 2. Configure RTSP source properties (latency, timeout, transport)
 * 3. Configure H.264 parser for timestamp generation
 * 4. Branch based on segmentation:
 *    - Segmented: Add queue + splitmuxsink with muxer
 *    - Continuous: Add muxer + filesink
 * 5. Link elements in pipeline
 * 6. Connect callbacks (pad-added, bus messages, format-location)
 * 7. Create main loop and start pipeline
 * 8. Launch recording thread
 * 
 * Segmented pipeline:
 *   rtspsrc -> rtph264depay -> h264parse -> queue -> splitmuxsink
 *                                                    (contains mp4mux)
 * 
 * Continuous pipeline:
 *   rtspsrc -> rtph264depay -> h264parse -> mp4mux -> filesink
 * 
 * @param[in,out] rec Pointer to CameraRecorder to start
 * @return 0 on success, -1 on failure (pipeline creation/start error)
 * 
 * Called from: manager_start_all()
 */
int recorder_start(CameraRecorder *rec) {
    GstBus *bus;

    if (!rec) return -1;

    // Create pipeline with unique name
    gchar *pipeline_name = g_strdup_printf("camera-%d", rec->camera_id);
    rec->pipeline = gst_pipeline_new(pipeline_name);
    g_free(pipeline_name);

    if (!rec->pipeline) {
        g_printerr("[%s] Failed to create pipeline\n", rec->camera_name);
        return -1;
    }

    // Create basic elements - select depay/parser based on video codec
    rec->rtspsrc = gst_element_factory_make("rtspsrc", NULL);
    gboolean is_h265 = (g_ascii_strcasecmp(rec->config.video_codec, "H.265") == 0 ||
                         g_ascii_strcasecmp(rec->config.video_codec, "H265") == 0 ||
                         g_ascii_strcasecmp(rec->config.video_codec, "HEVC") == 0);
    if (is_h265) {
        rec->depay  = gst_element_factory_make("rtph265depay", NULL);
        rec->parser = gst_element_factory_make("h265parse", NULL);
    } else {
        rec->depay  = gst_element_factory_make("rtph264depay", NULL);
        rec->parser = gst_element_factory_make("h264parse", NULL);
    }

    if (!rec->rtspsrc || !rec->depay || !rec->parser) {
        g_printerr("[%s] Failed to create basic elements\n", rec->camera_name);
        goto error;
    }

    // Configure H.264 parser to generate timestamps and insert config
    g_object_set(G_OBJECT(rec->parser),
                 "config-interval", -1,  // Insert SPS/PPS at every IDR frame
                 NULL);

    // Configure RTSP source properties
    g_object_set(G_OBJECT(rec->rtspsrc), 
                 "location", rec->camera_url,
                 "latency", rec->config.rtsp_latency_ms,
                 "protocols", rec->config.use_tcp ? 4 : 7,  // 4=TCP, 7=TCP+UDP
                 "timeout", rec->config.rtsp_timeout_sec * 1000000,  // Convert to microseconds
                 "user-agent", "GStreamer RTSP client",
                 "do-rtcp", FALSE,
                 "ntp-sync", FALSE,
                 "buffer-mode", 0,  // 0=NONE: let jitterbuffer use RTP timestamps
                 "tcp-timeout", rec->config.rtsp_timeout_sec * 1000000,
                 NULL);

    // Branch: Segmented vs Continuous recording
    if (rec->config.enable_segmentation) {
        // Segmented recording mode
        rec->queue = gst_element_factory_make("queue", NULL);
        rec->splitmux = gst_element_factory_make("splitmuxsink", NULL);
        rec->muxer = gst_element_factory_make("mp4mux", NULL);
        
        if (!rec->queue || !rec->splitmux || !rec->muxer) {
            g_printerr("[%s] Failed to create splitmux elements\n", rec->camera_name);
            goto error;
        }

        // Configure queue with unlimited buffering
        g_object_set(G_OBJECT(rec->queue),
                     "max-size-time", (guint64)0,
                     "max-size-bytes", 0,
                     "max-size-buffers", 0,
                     NULL);

        // Configure MP4 muxer for fragmentation if enabled
        if (rec->config.enable_fragments) {
            g_object_set(G_OBJECT(rec->muxer),
                         "streamable", TRUE,
                         "fragment-duration", rec->config.fragment_duration_ms,
                         NULL);
        }

        // Connect format-location callback for dynamic filename generation
        g_signal_connect(rec->splitmux, "format-location", 
                        G_CALLBACK(format_location_callback), rec);
        
        // Configure splitmuxsink with muxer and segmentation limits
        g_object_set(G_OBJECT(rec->splitmux),
                     "muxer", rec->muxer,
                     NULL);
        
        if (rec->config.max_file_size_mb > 0) {
            g_object_set(G_OBJECT(rec->splitmux),
                         "max-size-bytes", rec->config.max_file_size_mb * 1024 * 1024,
                         NULL);
        }
        if (rec->config.max_file_duration_sec > 0) {
            g_object_set(G_OBJECT(rec->splitmux),
                         "max-size-time", rec->config.max_file_duration_sec * GST_SECOND,
                         NULL);
        }
        
        // Add elements to pipeline
        gst_bin_add_many(GST_BIN(rec->pipeline),
                         rec->rtspsrc, rec->depay, rec->parser, 
                         rec->queue, rec->splitmux, NULL);
        
        // Link elements
        if (!gst_element_link_many(rec->depay, rec->parser, rec->queue, rec->splitmux, NULL)) {
            g_printerr("[%s] Failed to link elements\n", rec->camera_name);
            goto error;
        }
    } else {
        // Continuous recording mode
        rec->muxer = gst_element_factory_make("mp4mux", NULL);
        rec->filesink = gst_element_factory_make("filesink", NULL);
        
        if (!rec->muxer || !rec->filesink) {
            g_printerr("[%s] Failed to create muxer/filesink\n", rec->camera_name);
            goto error;
        }

        // Configure MP4 muxer for fragmentation if enabled
        if (rec->config.enable_fragments) {
            g_object_set(G_OBJECT(rec->muxer),
                         "streamable", TRUE,
                         "fragment-duration", rec->config.fragment_duration_ms,
                         NULL);
        }

        // Set output filename with extension
        gchar *output_filename = g_strdup_printf("%s.%s", 
                                                 rec->output_file, 
                                                 rec->config.file_extension);
        g_object_set(G_OBJECT(rec->filesink), "location", output_filename, NULL);
        g_free(output_filename);

        // Add elements to pipeline
        gst_bin_add_many(GST_BIN(rec->pipeline),
                         rec->rtspsrc, rec->depay, rec->parser,
                         rec->muxer, rec->filesink, NULL);

        // Link elements
        if (!gst_element_link_many(rec->depay, rec->parser, rec->muxer, rec->filesink, NULL)) {
            g_printerr("[%s] Failed to link elements\n", rec->camera_name);
            goto error;
        }
    }

    // Connect pad-added callback for dynamic RTSP pad linking
    g_signal_connect(rec->rtspsrc, "pad-added", G_CALLBACK(on_pad_added), rec->depay);

    // Install pad probe on parser's source pad to drop buffers without PTS.
    // Some cameras occasionally send frames without timestamps, which causes
    // mp4mux to fail with "Buffer has no PTS". This probe silently drops them.
    {
        GstPad *parser_src = gst_element_get_static_pad(rec->parser, "src");
        if (parser_src) {
            gst_pad_add_probe(parser_src, GST_PAD_PROBE_TYPE_BUFFER,
                (GstPadProbeCallback)drop_no_pts_probe, rec, NULL);
            gst_object_unref(parser_src);
        }
    }

    // Set up bus watch for messages
    bus = gst_pipeline_get_bus(GST_PIPELINE(rec->pipeline));
    gst_bus_add_watch(bus, bus_call, rec);
    gst_object_unref(bus);

    // Create main loop for this recorder
    rec->loop = g_main_loop_new(NULL, FALSE);

    // Log recording start information
    g_print("[%s] Starting recording\n", rec->camera_name);
    g_print("  URL: %s\n", rec->camera_url);
    g_print("  Output: %s\n", rec->output_file);
    if (rec->config.enable_segmentation) {
        g_print("  Segmentation: ");
        if (rec->config.max_file_size_mb > 0)
            g_print("%lu MB ", rec->config.max_file_size_mb);
        if (rec->config.max_file_duration_sec > 0)
            g_print("%lu sec ", rec->config.max_file_duration_sec);
        g_print("\n");
    }
    
    // Start pipeline
    GstStateChangeReturn ret = gst_element_set_state(rec->pipeline, GST_STATE_PLAYING);
    
    if (ret == GST_STATE_CHANGE_FAILURE) {
        g_printerr("[%s] Failed to start pipeline\n", rec->camera_name);
        gst_object_unref(rec->pipeline);
        g_main_loop_unref(rec->loop);
        return -1;
    }

    // Start recording thread
    rec->is_recording = TRUE;
    pthread_create(&rec->thread, NULL, recorder_thread, rec);

    return 0;

error:
    if (rec->pipeline) gst_object_unref(rec->pipeline);
    return -1;
}

/**
 * @brief Stop recording for a camera
 * 
 * Gracefully stops recording by sending EOS event, stopping pipeline,
 * joining recording thread, and cleaning up GStreamer resources.
 * Ensures proper file closure and resource cleanup.
 * 
 * Stop sequence:
 * 1. Set should_stop flag
 * 2. Quit main loop if running
 * 3. Join recording thread (wait for completion)
 * 4. Send EOS event to pipeline
 * 5. Wait for EOS to propagate (500ms)
 * 6. Set pipeline to NULL state
 * 7. Wait for state change completion
 * 8. Unreference pipeline and main loop
 * 
 * The EOS event ensures files are properly closed with correct
 * headers and indices before pipeline shutdown.
 * 
 * @param[in,out] rec Pointer to CameraRecorder to stop
 * 
 * Called from: manager_stop_all(), recorder_destroy()
 */
void recorder_stop(CameraRecorder *rec) {
    if (!rec || !rec->pipeline) return;

    g_print("[%s] Stopping...\n", rec->camera_name);
    rec->should_stop = TRUE;

    // Stop main loop if running
    if (rec->loop && g_main_loop_is_running(rec->loop)) {
        g_main_loop_quit(rec->loop);
    }

    // Wait for thread to finish
    if (rec->is_recording) {
        pthread_join(rec->thread, NULL);
    }

    if (rec->pipeline) {
        // Send EOS event for proper file closure
        gst_element_send_event(rec->pipeline, gst_event_new_eos());
        usleep(500000);  // Wait 500ms for EOS to propagate
        
        // Stop pipeline
        gst_element_set_state(rec->pipeline, GST_STATE_NULL);
        
        // Wait for state change to complete
        GstStateChangeReturn ret = gst_element_get_state(rec->pipeline, NULL, NULL, GST_CLOCK_TIME_NONE);
        if (ret == GST_STATE_CHANGE_FAILURE) {
            g_printerr("[%s] Failed to change state to NULL\n", rec->camera_name);
        }
        
        // Cleanup pipeline
        gst_object_unref(rec->pipeline);
        rec->pipeline = NULL;
    }

    // Cleanup main loop
    if (rec->loop) {
        g_main_loop_unref(rec->loop);
        rec->loop = NULL;
    }

    rec->is_recording = FALSE;
    g_print("[%s] Stopped\n", rec->camera_name);
}

/**
 * @brief Destroy camera recorder and free resources
 * 
 * Ensures recording is stopped and frees all allocated memory.
 * After this call, the recorder pointer is invalid and must not be used.
 * 
 * Cleanup sequence:
 * 1. Stop recording if currently active
 * 2. Free recorder structure
 * 
 * @param[in,out] rec Pointer to CameraRecorder to destroy (invalidated after call)
 * 
 * Called from: manager_destroy()
 */
void recorder_destroy(CameraRecorder *rec) {
    if (!rec) return;
    if (rec->is_recording) {
        recorder_stop(rec);
    }
    g_free(rec);
}
