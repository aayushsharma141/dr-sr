"""Schemas for hospital departments and doctor membership."""
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field

class DepartmentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name_en: str = Field(min_length=2, max_length=120)
    name_hi: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=500)

class DepartmentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name_en: str = Field(min_length=2, max_length=120)
    name_hi: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    is_active: bool
    version_id: int = Field(ge=1)

class DepartmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name_en: str
    name_hi: str | None
    description: str | None
    is_active: bool
    version_id: int
    created_at: datetime
    updated_at: datetime

class DoctorDepartmentAssignment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    department_ids: list[int] = Field(max_length=30)
    version_id: int = Field(ge=1)
