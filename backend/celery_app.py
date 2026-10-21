import os
from celery import Celery
celery_app=Celery("ecotrack",broker=os.getenv("REDIS_URL","redis://localhost:6379/0"),backend=os.getenv("REDIS_URL","redis://localhost:6379/0"))
celery_app.conf.beat_schedule={"daily-sustainability-report":{"task":"tasks.generate_report","schedule":86400}}
celery_app.conf.timezone="Asia/Kolkata"
