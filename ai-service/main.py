import base64
from pathlib import Path

import cv2
import numpy as np
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="EcoTrack AI Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "yolo11n.pt"

model = None
model_error = None

try:
    from ultralytics import YOLO

    if MODEL_PATH.exists():
        model = YOLO(str(MODEL_PATH))
    else:
        model_error = f"Model file not found: {MODEL_PATH}"

except Exception as e:
    model_error = str(e)


@app.get("/")
def root():
    return {
        "service": "EcoTrack AI Service",
        "status": "running",
        "model_loaded": model is not None,
    }


@app.get("/health")
def health():
    return {
        "service": "ai-service",
        "opencv": cv2.__version__,
        "model_loaded": model is not None,
        "model_path": str(MODEL_PATH),
        "model_exists": MODEL_PATH.exists(),
        "model_error": model_error,
    }


@app.post("/detect")
async def detect(file: UploadFile = File(...)):
    if model is None:
        return {
            "success": False,
            "error": "YOLO model is not loaded",
            "model_path": str(MODEL_PATH),
            "model_exists": MODEL_PATH.exists(),
            "model_error": model_error,
        }

    data = await file.read()

    image_array = np.frombuffer(data, dtype=np.uint8)
    image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)

    if image is None:
        return {
            "success": False,
            "error": "Could not decode uploaded image",
        }

    height, width = image.shape[:2]

    results = model(image, verbose=False)

    detections = []

    class_counts = {
        "car": 0,
        "motorcycle": 0,
        "bus": 0,
        "truck": 0,
    }

    vehicle_classes = {
        2: "car",
        3: "motorcycle",
        5: "bus",
        7: "truck",
    }

    annotated = image.copy()

    for result in results:
        if result.boxes is None:
            continue

        for box in result.boxes:
            xyxy = box.xyxy[0].cpu().numpy().tolist()
            confidence = float(box.conf[0].cpu().numpy())
            class_id = int(box.cls[0].cpu().numpy())

            class_name = model.names.get(class_id, str(class_id))

            x1, y1, x2, y2 = map(int, xyxy)

            detections.append(
                {
                    "class_id": class_id,
                    "class_name": class_name,
                    "confidence": round(confidence, 4),
                    "box": [x1, y1, x2, y2],
                }
            )

            if class_id in vehicle_classes:
                vehicle_name = vehicle_classes[class_id]
                class_counts[vehicle_name] += 1

                cv2.rectangle(
                    annotated,
                    (x1, y1),
                    (x2, y2),
                    (0, 255, 0),
                    2,
                )

                label = f"{vehicle_name} {confidence:.2f}"

                cv2.putText(
                    annotated,
                    label,
                    (x1, max(y1 - 10, 20)),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.6,
                    (0, 255, 0),
                    2,
                )

    vehicle_total = sum(class_counts.values())

    success, encoded_image = cv2.imencode(".jpg", annotated)

    annotated_base64 = ""

    if success:
        annotated_base64 = base64.b64encode(
            encoded_image.tobytes()
        ).decode("utf-8")

    return {
        "success": True,
        "filename": file.filename,
        "image_width": width,
        "image_height": height,
        "object_count": len(detections),
        "vehicle_total": vehicle_total,
        "car_count": class_counts["car"],
        "motorcycle_count": class_counts["motorcycle"],
        "bus_count": class_counts["bus"],
        "truck_count": class_counts["truck"],
        "detections": detections,
        "annotated_image": annotated_base64,
    }