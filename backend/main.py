import os
import json
from io import BytesIO
from datetime import datetime, timedelta
from typing import Literal, Optional

from fastapi import (
    FastAPI,
    Depends,
    HTTPException,
    WebSocket,
    WebSocketDisconnect,
    UploadFile,
    File,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm

from jose import JWTError, jwt
from passlib.context import CryptContext

from pydantic import BaseModel, Field

from sqlalchemy import (
    create_engine,
    Column,
    Integer,
    String,
    Float,
    DateTime,
    Text,
)
from sqlalchemy.orm import declarative_base, sessionmaker, Session

import strawberry
from strawberry.fastapi import GraphQLRouter

from openpyxl import load_workbook


# =========================================================
# CONFIGURATION
# =========================================================

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg://ecotrack:ecotrack@localhost:5432/ecotrack",
)

SECRET_KEY = os.getenv(
    "SECRET_KEY",
    "CHANGE_THIS_SECRET_IN_PRODUCTION",
)

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60


# =========================================================
# DATABASE
# =========================================================

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
)

Base = declarative_base()


# =========================================================
# EMISSION FACTORS
# =========================================================

FACTORS = {
    "Energy": 0.7,
    "Fuel": 2.68,
    "Resource": 0.5,
}


# =========================================================
# DATABASE MODELS
# =========================================================

class ConsumptionDB(Base):
    __tablename__ = "consumptions"

    id = Column(Integer, primary_key=True)

    type = Column(
        String(20),
        nullable=False,
    )

    quantity = Column(
        Float,
        nullable=False,
    )

    unit = Column(
        String(30),
        nullable=False,
    )

    date = Column(
        String(20),
        nullable=False,
    )

    emission = Column(
        Float,
        nullable=False,
    )

    source = Column(
        String(40),
        default="manual",
    )

    asset_tag = Column(
        String(100),
        nullable=True,
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
    )


class AuditDB(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True)

    username = Column(
        String(100),
        nullable=False,
    )

    action = Column(
        String(50),
        nullable=False,
    )

    entity = Column(
        String(100),
        nullable=False,
    )

    details = Column(
        Text,
        default="",
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
    )


class AssetDB(Base):
    __tablename__ = "assets"

    id = Column(Integer, primary_key=True)

    asset_tag = Column(
        String(100),
        unique=True,
        nullable=False,
        index=True,
    )

    name = Column(
        String(150),
        nullable=False,
    )

    category = Column(
        String(80),
        default="General",
    )

    location = Column(
        String(150),
        default="Main Facility",
    )

    status = Column(
        String(30),
        default="Active",
    )

    barcode = Column(
        String(120),
        nullable=True,
    )

    rfid_tag = Column(
        String(120),
        nullable=True,
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
    )


class AIDetectionDB(Base):
    __tablename__ = "ai_detections"

    id = Column(Integer, primary_key=True)

    filename = Column(
        String(255),
        default="uploaded-image",
    )

    image_width = Column(
        Integer,
        nullable=False,
    )

    image_height = Column(
        Integer,
        nullable=False,
    )

    object_count = Column(
        Integer,
        nullable=False,
        default=0,
    )

    vehicle_total = Column(
        Integer,
        nullable=False,
        default=0,
    )

    car_count = Column(
        Integer,
        nullable=False,
        default=0,
    )

    motorcycle_count = Column(
        Integer,
        nullable=False,
        default=0,
    )

    bus_count = Column(
        Integer,
        nullable=False,
        default=0,
    )

    truck_count = Column(
        Integer,
        nullable=False,
        default=0,
    )

    avg_confidence = Column(
        Float,
        nullable=False,
        default=0,
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
    )


class AssetScanDB(Base):
    __tablename__ = "asset_scan_history"

    id = Column(Integer, primary_key=True)

    asset_tag = Column(
        String(100),
        nullable=False,
        index=True,
    )

    scan_type = Column(
        String(30),
        nullable=False,
    )

    username = Column(
        String(100),
        nullable=False,
    )

    location = Column(
        String(150),
        default="Main Facility",
    )

    result = Column(
        String(30),
        default="FOUND",
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
    )


# Create tables
Base.metadata.create_all(bind=engine)


# =========================================================
# FASTAPI APP
# =========================================================

app = FastAPI(
    title="EcoTrack Enterprise API",
    version="2.0.0",
)


# =========================================================
# CORS
# =========================================================

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


# =========================================================
# AUTHENTICATION / SECURITY
# =========================================================

pwd_context = CryptContext(
    schemes=["bcrypt"],
    deprecated="auto",
)

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="/auth/token",
)


# Development users
USERS = {
    "admin": {
        "password": pwd_context.hash("admin123"),
        "role": "admin",
    },
    "analyst": {
        "password": pwd_context.hash("analyst123"),
        "role": "analyst",
    },
}


# =========================================================
# DATABASE DEPENDENCY
# =========================================================

def db():
    s = SessionLocal()
    try:
        yield s
    finally:
        s.close()


# =========================================================
# AUTH FUNCTIONS
# =========================================================

def authenticate(username, password):
    user = USERS.get(username)
    if not user:
        return None
    if not pwd_context.verify(password, user["password"]):
        return None
    return {
        "username": username,
        "role": user["role"],
    }


def create_token(data):
    payload = data.copy()
    payload["exp"] = (
        datetime.utcnow()
        + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    return jwt.encode(
        payload,
        SECRET_KEY,
        algorithm=ALGORITHM,
    )


def current_user(token: str = Depends(oauth2_scheme)):
    try:
        payload = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM],
        )
        username = payload.get("sub")
        role = payload.get("role")
        if not username:
            raise ValueError()
        return {
            "username": username,
            "role": role,
        }
    except (JWTError, ValueError):
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token",
        )


def require_role(*allowed_roles):
    def checker(user=Depends(current_user)):
        if user.get("role") not in allowed_roles:
            raise HTTPException(
                status_code=403,
                detail="Insufficient permissions",
            )
        return user
    return checker


# =========================================================
# PYDANTIC MODELS
# =========================================================

class ConsumptionIn(BaseModel):
    type: Literal["Energy", "Fuel", "Resource"]
    quantity: float = Field(gt=0)
    unit: str
    date: str
    source: str = "manual"
    asset_tag: Optional[str] = None


class AssetIn(BaseModel):
    asset_tag: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=150)
    category: str = "General"
    location: str = "Main Facility"
    barcode: Optional[str] = None
    rfid_tag: Optional[str] = None


class ScanIn(BaseModel):
    tag: str = Field(min_length=1, max_length=120)
    scan_type: Literal["BARCODE", "RFID"]
    location: str = "Main Facility"


class AIDetectionIn(BaseModel):
    filename: str = "uploaded-image"
    width: int
    height: int
    object_count: int = 0
    vehicle_total: int = 0
    vehicle_counts: dict[str, int] = {}
    detections: list[dict] = []


# =========================================================
# WEBSOCKET HUB
# =========================================================

class Hub:
    def __init__(self):
        self.clients = set()

    async def broadcast(self, payload):
        dead = []
        for ws in self.clients:
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)


hub = Hub()


# =========================================================
# AUDIT FUNCTION
# =========================================================

def audit(s, user, action, entity, details=""):
    s.add(
        AuditDB(
            username=user["username"],
            action=action,
            entity=entity,
            details=details,
        )
    )
    s.commit()


# =========================================================
# BASIC ENDPOINTS
# =========================================================

@app.get("/")
def root():
    return {
        "service": "EcoTrack Enterprise API",
        "status": "running",
    }


@app.get("/health")
def health():
    return {
        "status": "healthy",
        "database": "PostgreSQL",
    }


# =========================================================
# AUTH LOGIN
# =========================================================

@app.post("/auth/token")
def token(form: OAuth2PasswordRequestForm = Depends()):
    user = authenticate(form.username, form.password)
    if not user:
        raise HTTPException(
            status_code=401,
            detail="Incorrect username or password",
        )
    return {
        "access_token": create_token(
            {
                "sub": user["username"],
                "role": user["role"],
            }
        ),
        "token_type": "bearer",
        "role": user["role"],
    }


@app.get("/me")
def me(user=Depends(current_user)):
    return user


# =========================================================
# CONSUMPTIONS
# =========================================================

@app.post("/consumptions")
async def add_consumption(
    item: ConsumptionIn,
    s: Session = Depends(db),
    user=Depends(current_user),
):
    emission = item.quantity * FACTORS[item.type]
    row = ConsumptionDB(
        **item.model_dump(),
        emission=emission,
    )
    s.add(row)
    s.commit()
    s.refresh(row)
    audit(
        s,
        user,
        "CREATE",
        "consumption",
        json.dumps(
            {
                "id": row.id,
                "type": row.type,
            }
        ),
    )
    await hub.broadcast(
        {
            "event": "consumption_created",
            "id": row.id,
            "emission": emission,
        }
    )
    return {
        "id": row.id,
        "type": row.type,
        "quantity": row.quantity,
        "unit": row.unit,
        "date": row.date,
        "emission": round(emission, 2),
    }


@app.get("/consumptions")
def consumptions(
    s: Session = Depends(db),
    user=Depends(current_user),
):
    rows = (
        s.query(ConsumptionDB)
        .order_by(ConsumptionDB.id.desc())
        .all()
    )
    return [
        {
            "id": r.id,
            "type": r.type,
            "quantity": r.quantity,
            "unit": r.unit,
            "date": r.date,
            "emission": r.emission,
            "source": r.source,
            "asset_tag": r.asset_tag,
        }
        for r in rows
    ]


@app.delete("/consumptions/{id}")
async def delete_consumption(
    id: int,
    s: Session = Depends(db),
    user=Depends(require_role("admin")),
):
    row = s.get(ConsumptionDB, id)
    if not row:
        raise HTTPException(
            status_code=404,
            detail="Consumption record not found",
        )
    s.delete(row)
    s.commit()
    audit(s, user, "DELETE", "consumption", str(id))
    await hub.broadcast(
        {
            "event": "consumption_deleted",
            "id": id,
        }
    )
    return {"message": "deleted"}


# =========================================================
# SUMMARY
# =========================================================

@app.get("/summary")
def summary(
    s: Session = Depends(db),
    user=Depends(current_user),
):
    rows = s.query(ConsumptionDB).all()
    return {
        "total_records": len(rows),
        "total_emission_kg": round(
            sum(r.emission for r in rows), 2
        ),
        "energy_usage": round(
            sum(r.quantity for r in rows if r.type == "Energy"), 2
        ),
        "fuel_usage": round(
            sum(r.quantity for r in rows if r.type == "Fuel"), 2
        ),
        "resource_usage": round(
            sum(r.quantity for r in rows if r.type == "Resource"), 2
        ),
    }


# =========================================================
# AUDIT LOGS
# =========================================================

@app.get("/audit-logs")
def audit_logs(
    limit: int = 200,
    s: Session = Depends(db),
    user=Depends(require_role("admin")),
):
    limit = max(1, min(limit, 500))
    rows = (
        s.query(AuditDB)
        .order_by(AuditDB.id.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": r.id,
            "username": r.username,
            "action": r.action,
            "entity": r.entity,
            "details": r.details,
            "created_at": (
                r.created_at.isoformat()
                if r.created_at
                else None
            ),
        }
        for r in rows
    ]


# =========================================================
# SECURITY USERS
# =========================================================

@app.get("/security/users")
def security_users(user=Depends(require_role("admin"))):
    return [
        {
            "username": name,
            "role": data["role"],
        }
        for name, data in USERS.items()
    ]


# =========================================================
# ASSETS
# =========================================================

@app.get("/assets")
def assets(
    s: Session = Depends(db),
    user=Depends(current_user),
):
    rows = (
        s.query(AssetDB)
        .order_by(AssetDB.id.desc())
        .all()
    )
    return [
        {
            "id": r.id,
            "asset_tag": r.asset_tag,
            "name": r.name,
            "category": r.category,
            "location": r.location,
            "status": r.status,
            "barcode": r.barcode,
            "rfid_tag": r.rfid_tag,
        }
        for r in rows
    ]


@app.post("/assets")
def create_asset(
    item: AssetIn,
    s: Session = Depends(db),
    user=Depends(require_role("admin")),
):
    existing = (
        s.query(AssetDB)
        .filter(AssetDB.asset_tag == item.asset_tag)
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail="Asset tag already exists",
        )
    row = AssetDB(**item.model_dump())
    s.add(row)
    s.commit()
    s.refresh(row)
    audit(
        s,
        user,
        "CREATE",
        "asset",
        json.dumps({"asset_tag": row.asset_tag}),
    )
    return {
        "id": row.id,
        "asset_tag": row.asset_tag,
        "name": row.name,
        "status": row.status,
    }


# =========================================================
# BARCODE / RFID ASSET SCANNING
# =========================================================

@app.post("/assets/scan")
async def scan_asset(
    item: ScanIn,
    s: Session = Depends(db),
    user=Depends(current_user),
):
    tag = item.tag.strip()
    asset = (
        s.query(AssetDB)
        .filter(
            (AssetDB.asset_tag == tag)
            | (AssetDB.barcode == tag)
            | (AssetDB.rfid_tag == tag)
        )
        .first()
    )
    result = "FOUND" if asset else "NOT_FOUND"
    history = AssetScanDB(
        asset_tag=asset.asset_tag if asset else tag,
        scan_type=item.scan_type,
        username=user["username"],
        location=item.location,
        result=result,
    )
    s.add(history)
    s.commit()
    audit(
        s,
        user,
        "SCAN",
        item.scan_type,
        json.dumps({"tag": tag, "result": result}),
    )
    await hub.broadcast(
        {
            "event": "asset_scanned",
            "tag": tag,
            "scan_type": item.scan_type,
            "result": result,
        }
    )
    if not asset:
        return {
            "found": False,
            "result": "NOT_FOUND",
            "message": "Asset not registered",
            "tag": tag,
        }
    return {
        "found": True,
        "result": "FOUND",
        "asset": {
            "asset_tag": asset.asset_tag,
            "name": asset.name,
            "category": asset.category,
            "location": asset.location,
            "status": asset.status,
            "barcode": asset.barcode,
            "rfid_tag": asset.rfid_tag,
        },
    }


@app.get("/assets/scans")
def scan_history(
    s: Session = Depends(db),
    user=Depends(current_user),
):
    rows = (
        s.query(AssetScanDB)
        .order_by(AssetScanDB.id.desc())
        .limit(200)
        .all()
    )
    return [
        {
            "id": r.id,
            "asset_tag": r.asset_tag,
            "scan_type": r.scan_type,
            "username": r.username,
            "location": r.location,
            "result": r.result,
            "created_at": (
                r.created_at.isoformat()
                if r.created_at
                else None
            ),
        }
        for r in rows
    ]


# =========================================================
# DEVICE ENDPOINTS
# =========================================================

@app.post("/device/barcode")
async def barcode(tag: str, user=Depends(current_user)):
    return {
        "accepted": True,
        "device": "barcode_scanner",
        "asset_tag": tag,
    }


@app.post("/device/rfid")
async def rfid(tag: str, user=Depends(current_user)):
    return {
        "accepted": True,
        "device": "rfid_reader",
        "asset_tag": tag,
    }


# =========================================================
# ZPL LABEL
# =========================================================

@app.get("/device/zpl/{tag}")
def zpl(tag: str, user=Depends(current_user)):
    safe = tag.replace("^", "")
    zpl_code = (
        "^XA"
        "^FO50,50"
        "^A0N,40,40"
        f"^FD{safe}^FS"
        "^XZ"
    )
    return {
        "device": "zpl_printer",
        "zpl": zpl_code,
    }


# =========================================================
# AI DETECTION
# =========================================================

@app.post("/ai/detections")
def save_ai_detection(
    item: AIDetectionIn,
    s: Session = Depends(db),
    user=Depends(current_user),
):
    confidences = [
        float(d.get("confidence", 0))
        for d in item.detections
        if isinstance(d, dict)
    ]
    avg_confidence = (
        sum(confidences) / len(confidences)
        if confidences
        else 0
    )
    counts = item.vehicle_counts or {}
    row = AIDetectionDB(
        filename=item.filename or "uploaded-image",
        image_width=item.width,
        image_height=item.height,
        object_count=item.object_count,
        vehicle_total=item.vehicle_total,
        car_count=int(counts.get("car", 0)),
        motorcycle_count=int(counts.get("motorcycle", 0)),
        bus_count=int(counts.get("bus", 0)),
        truck_count=int(counts.get("truck", 0)),
        avg_confidence=avg_confidence,
    )
    s.add(row)
    s.commit()
    s.refresh(row)
    audit(
        s,
        user,
        "CREATE",
        "ai_detection",
        json.dumps(
            {
                "id": row.id,
                "filename": row.filename,
                "vehicle_total": row.vehicle_total,
            }
        ),
    )
    return {
        "saved": True,
        "id": row.id,
        "avg_confidence": round(avg_confidence, 3),
    }


@app.get("/ai/detections")
def ai_detections(
    s: Session = Depends(db),
    user=Depends(current_user),
):
    rows = (
        s.query(AIDetectionDB)
        .order_by(AIDetectionDB.id.desc())
        .limit(200)
        .all()
    )
    return [
        {
            "id": r.id,
            "filename": r.filename,
            "image_width": r.image_width,
            "image_height": r.image_height,
            "object_count": r.object_count,
            "vehicle_total": r.vehicle_total,
            "car_count": r.car_count,
            "motorcycle_count": r.motorcycle_count,
            "bus_count": r.bus_count,
            "truck_count": r.truck_count,
            "avg_confidence": round(r.avg_confidence, 3),
            "created_at": (
                r.created_at.isoformat()
                if r.created_at
                else None
            ),
        }
        for r in rows
    ]


@app.post("/ai/detect")
async def ai_detect(
    file: UploadFile = File(...),
    user=Depends(current_user),
):
    data = await file.read()
    return {
        "filename": file.filename,
        "bytes": len(data),
        "status": "queued",
        "message": "Send image to ai-service for OpenCV + YOLO/Detectron2 inference.",
    }


# =========================================================
# EXCEL IMPORT HELPERS
# =========================================================

def parse_import_datetime(value):
    if value is None:
        return datetime.utcnow()
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    text = str(value).strip()
    if not text:
        return datetime.utcnow()
    try:
        return datetime.fromisoformat(
            text.replace("Z", "+00:00")
        ).replace(tzinfo=None)
    except Exception:
        return datetime.utcnow()


def get_sheet_records(ws):
    headers = [
        str(cell.value).strip()
        if cell.value is not None
        else ""
        for cell in ws[1]
    ]
    records = []
    for values in ws.iter_rows(min_row=2, values_only=True):
        record = dict(zip(headers, values))
        records.append(record)
    return records


# =========================================================
# EXCEL DATASET IMPORT (WITH URL ALIASES)
# =========================================================

@app.post("/import-excel/")
@app.post("/import/excel")
async def import_excel(
    file: UploadFile = File(...),
    s: Session = Depends(db),
    user=Depends(require_role("admin")),
):
    filename = file.filename or ""

    if not filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(
            status_code=400,
            detail="Please upload an Excel .xlsx or .xls file",
        )

    try:
        data = await file.read()
        if not data:
            raise HTTPException(
                status_code=400,
                detail="Uploaded Excel file is empty",
            )

        workbook = load_workbook(
            filename=BytesIO(data),
            data_only=True,
        )

        imported = {"Consumptions": 0, "Assets": 0}
        skipped = {"Consumptions": 0, "Assets": 0}

        # Handle sheet matching flexibly (supports 'Consumptions' or active default sheet)
        sheet_name = "Consumptions" if "Consumptions" in workbook.sheetnames else workbook.sheetnames[0]
        ws = workbook[sheet_name]
        records = get_sheet_records(ws)

        for record in records:
            if not record.get("type"):
                skipped["Consumptions"] += 1
                continue

            record_type = str(record.get("type")).strip()
            if record_type not in FACTORS:
                skipped["Consumptions"] += 1
                continue

            try:
                quantity = float(record.get("quantity") or 0)
            except (TypeError, ValueError):
                skipped["Consumptions"] += 1
                continue

            if quantity <= 0:
                skipped["Consumptions"] += 1
                continue

            unit = str(record.get("unit") or ("kWh" if record_type == "Energy" else "Litres" if record_type == "Fuel" else "Units")).strip()
            date_value = record.get("date")

            if isinstance(date_value, datetime):
                date_text = date_value.strftime("%Y-%m-%d")
            else:
                date_text = str(date_value or datetime.utcnow().strftime("%Y-%m-%d")).strip()

            source = str(record.get("source") or "excel_import").strip()
            asset_tag = record.get("asset_tag")
            if asset_tag is not None:
                asset_tag = str(asset_tag).strip()
                if not asset_tag:
                    asset_tag = None

            # Duplicate check
            existing = (
                s.query(ConsumptionDB)
                .filter(
                    ConsumptionDB.type == record_type,
                    ConsumptionDB.quantity == quantity,
                    ConsumptionDB.unit == unit,
                    ConsumptionDB.date == date_text,
                    ConsumptionDB.source == source,
                    ConsumptionDB.asset_tag == asset_tag,
                )
                .first()
            )

            if existing:
                skipped["Consumptions"] += 1
                continue

            emission = quantity * FACTORS[record_type]

            row = ConsumptionDB(
                type=record_type,
                quantity=quantity,
                unit=unit,
                date=date_text,
                emission=emission,
                source=source,
                asset_tag=asset_tag,
            )

            s.add(row)
            imported["Consumptions"] += 1

        s.commit()

        return {
            "success": True,
            "message": f"Successfully imported {imported['Consumptions']} rows from {filename}!",
            "imported": imported,
            "skipped": skipped,
        }

    except Exception as e:
        s.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Error processing Excel file: {str(e)}",
        )