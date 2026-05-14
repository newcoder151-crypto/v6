"""
Railway mNVR — YOLO Inference Sidecar
Endpoints: /health, /detect, /people-count, /intrusion, /object-detect
Auto-starts with:  bash start.sh  (runs inside isolated venv)
"""
from __future__ import annotations
import io, os, time, json
from typing import Dict, Optional
from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from ultralytics import YOLO

DEFAULT_MODEL = os.environ.get("YOLO_MODEL", "yolov8n.pt")

app = FastAPI(title="Railway NVR AI Sidecar", version="2.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_models: Dict[str, YOLO] = {}

def get_model(name: str) -> YOLO:
    if name not in _models:
        print(f"[YOLO] Loading model: {name}")
        _models[name] = YOLO(name)
        print(f"[YOLO] Model ready: {name}")
    return _models[name]

def open_image(raw: bytes) -> Image.Image:
    try:
        return Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as e:
        raise HTTPException(400, f"Invalid image: {e}")

def run_inference(img: Image.Image, model_name: str, conf: float):
    model = get_model(model_name)
    t0 = time.perf_counter()
    results = model.predict(img, conf=conf, verbose=False)
    ms = round((time.perf_counter() - t0) * 1000, 1)
    dets = []
    for r in results:
        for box in r.boxes:
            dets.append({
                "label":      r.names[int(box.cls[0])],
                "confidence": round(float(box.conf[0]), 4),
                "bbox":       [round(v, 2) for v in box.xyxy[0].tolist()],
            })
    return dets, ms, list(img.size)

@app.on_event("startup")
async def preload():
    """Pre-load default model so first inference is fast."""
    try:
        get_model(DEFAULT_MODEL)
    except Exception as e:
        print(f"[YOLO] Pre-load warning: {e}")

@app.get("/health")
def health():
    return {
        "status": "ok",
        "default_model": DEFAULT_MODEL,
        "loaded_models": list(_models.keys()),
    }

@app.post("/detect")
async def detect(
    image: UploadFile = File(...),
    conf: float = Form(0.35),
    model: str = Form(DEFAULT_MODEL),
):
    raw = await image.read()
    img = open_image(raw)
    dets, ms, size = run_inference(img, model, conf)
    return {"model": model, "inference_ms": ms, "image_size": size, "detections": dets}

@app.post("/people-count")
async def people_count(
    image: UploadFile = File(...),
    conf: float = Form(0.4),
    model: str = Form(DEFAULT_MODEL),
    camera_id: Optional[int] = Form(None),
):
    raw = await image.read()
    img = open_image(raw)
    dets, ms, size = run_inference(img, model, conf)
    people = [d for d in dets if d["label"] == "person"]
    count = len(people)
    W, H = size
    frame_area = W * H
    person_area = sum(
        (d["bbox"][2] - d["bbox"][0]) * (d["bbox"][3] - d["bbox"][1])
        for d in people
    )
    density = min(100, round((person_area / frame_area) * 300)) if frame_area > 0 else 0
    level = "HIGH" if density > 60 else "MEDIUM" if density > 30 else "LOW"
    return {
        "model": model, "inference_ms": ms, "image_size": size,
        "detections": dets, "people_count": count,
        "density_percent": density, "density_level": level,
        "people_detections": people,
    }

@app.post("/intrusion")
async def intrusion(
    image: UploadFile = File(...),
    conf: float = Form(0.4),
    model: str = Form(DEFAULT_MODEL),
    zone: str = Form('{"x1":0,"y1":0,"x2":100,"y2":100}'),
    camera_id: Optional[int] = Form(None),
):
    raw = await image.read()
    img = open_image(raw)
    dets, ms, size = run_inference(img, model, conf)
    z = json.loads(zone)
    W, H = size
    zx1, zy1 = (z["x1"] / 100) * W, (z["y1"] / 100) * H
    zx2, zy2 = (z["x2"] / 100) * W, (z["y2"] / 100) * H
    intruders = [
        d for d in dets
        if zx1 <= (d["bbox"][0] + d["bbox"][2]) / 2 <= zx2
        and zy1 <= (d["bbox"][1] + d["bbox"][3]) / 2 <= zy2
    ]
    return {
        "model": model, "inference_ms": ms, "image_size": size,
        "detections": dets, "zone": z,
        "intrusion_detected": len(intruders) > 0,
        "intruder_count": len(intruders),
        "intruders": intruders,
    }

@app.post("/object-detect")
async def object_detect(
    image: UploadFile = File(...),
    conf: float = Form(0.35),
    model: str = Form(DEFAULT_MODEL),
    filter_class: Optional[str] = Form(None),
):
    raw = await image.read()
    img = open_image(raw)
    dets, ms, size = run_inference(img, model, conf)
    if filter_class:
        dets = [d for d in dets if d["label"].lower() == filter_class.lower()]
    summary: Dict[str, int] = {}
    for d in dets:
        summary[d["label"]] = summary.get(d["label"], 0) + 1
    return {
        "model": model, "inference_ms": ms, "image_size": size,
        "detections": dets, "summary": summary, "total_detected": len(dets),
    }
