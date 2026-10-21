from django.contrib import admin
from .models import ComplianceCheck
@admin.register(ComplianceCheck)
class ComplianceCheckAdmin(admin.ModelAdmin):
    list_display=("name","status","due_date")
    list_filter=("status",)
