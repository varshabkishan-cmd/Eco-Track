# EcoTrack Enterprise Sustainability Platform

A full-stack prototype implementing the requested enterprise stack.

## Implemented stack
React + TypeScript + CSS; FastAPI; Django Admin; WebSocket; GraphQL; PostgreSQL; OpenCV + YOLO integration point; barcode/RFID endpoints; ZPL generation; Celery + Redis; OAuth2/JWT; audit logs; Docker; Kubernetes; GitHub Actions.

## Local development

### 1. PostgreSQL and Redis
Recommended easiest route:
`docker compose up -d postgres redis`

### 2. FastAPI
PowerShell:
`cd backend`
`python -m venv .venv`
`.\.venv\Scripts\Activate.ps1`
`pip install -r requirements.txt`
`python -m uvicorn main:app --reload`

### 3. Django Admin
Open a second terminal:
`cd django_admin`
`pip install -r requirements.txt`
`python manage.py migrate`
`python manage.py createsuperuser`
`python manage.py runserver 8002`

### 4. Frontend
Open another terminal:
`cd frontend`
`npm install`
`npm.cmd run dev`

Open the Vite URL shown in the terminal.

Demo OAuth2 credentials: `admin / admin123` (development only).

## API features
- REST: `/consumptions`, `/summary`
- GraphQL: `/graphql`
- WebSocket: `/ws/updates`
- Audit: `/audit-logs`
- Devices: `/device/barcode`, `/device/rfid`, `/device/zpl/{tag}`
- AI gateway: `/ai/detect`
- AI service: `http://localhost:8001/detect`

## Important
Real RFID readers, barcode scanners, Zebra/ZPL printers, cameras and production TLS certificates require physical hardware/network configuration. The repository includes working integration endpoints and safe development simulations. A YOLO model file must be supplied to run actual model inference.
