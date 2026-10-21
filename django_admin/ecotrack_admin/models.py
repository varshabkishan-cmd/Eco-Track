from django.db import models
class ComplianceCheck(models.Model):
    name=models.CharField(max_length=200)
    requirement=models.TextField()
    status=models.CharField(max_length=30,default="Pending")
    due_date=models.DateField(null=True,blank=True)
    class Meta: verbose_name="Compliance Check"
