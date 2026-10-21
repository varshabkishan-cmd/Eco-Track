from celery_app import celery_app
@celery_app.task
def generate_report():
    # Replace with PDF/Excel generation in production.
    return {"status":"generated","report":"sustainability"}
