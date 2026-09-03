package service

import (
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"sso-server/internal/model"
	"sso-server/internal/repository"
)

func TestEnsureTargetDeptRepairsStaleBinding(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Department{}, &model.DirectorySyncBinding{}); err != nil {
		t.Fatal(err)
	}

	parent := model.Department{Name: "FIT2CLOUD"}
	if err := db.Create(&parent).Error; err != nil {
		t.Fatal(err)
	}
	staleID := uuid.New()
	extID := "newdept:wecom:" + parent.ID.String() + ":北区"
	stale := model.DirectorySyncBinding{
		Provider:     "wecom",
		ExternalType: "department",
		ExternalID:   extID,
		LocalID:      staleID,
	}
	if err := db.Create(&stale).Error; err != nil {
		t.Fatal(err)
	}

	svc := &DirectorySyncService{db: db}
	target := &mappingTarget{kind: "create", name: "北区", parentID: &parent.ID}
	id := svc.ensureTargetDept(db, DirectorySyncConfig{PlatformType: "wecom"}, target, false, nil)
	if id == nil || *id == staleID {
		t.Fatalf("expected repaired department id, got %v", id)
	}

	var dept model.Department
	if err := db.First(&dept, "id = ?", *id).Error; err != nil {
		t.Fatalf("recreated department not found: %v", err)
	}
	if dept.Name != "北区" || dept.ParentID == nil || *dept.ParentID != parent.ID {
		t.Fatalf("unexpected recreated department: %+v", dept)
	}

	var repaired model.DirectorySyncBinding
	if err := db.Where("provider = ? AND external_type = ? AND external_id = ?", "wecom", "department", extID).
		First(&repaired).Error; err != nil {
		t.Fatalf("repaired binding not found: %v", err)
	}
	if repaired.LocalID != *id {
		t.Fatalf("binding still points at %s, want %s", repaired.LocalID, *id)
	}
}

func TestResetManagedDepartmentsPreservesManualOrganizations(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&model.Department{},
		&model.DirectorySyncBinding{},
		&model.DirectorySyncBuffer{},
		&model.SystemConfig{},
		&model.User{},
	); err != nil {
		t.Fatal(err)
	}

	mount := model.Department{Name: "FIT2CLOUD", Description: "手工组织"}
	if err := db.Create(&mount).Error; err != nil {
		t.Fatal(err)
	}
	managed := model.Department{Name: "北区", ParentID: &mount.ID, Description: "directory sync on-demand"}
	if err := db.Create(&managed).Error; err != nil {
		t.Fatal(err)
	}
	manualChild := model.Department{Name: "手工保留部门", ParentID: &managed.ID}
	if err := db.Create(&manualChild).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.DirectorySyncBinding{
		Provider: "wecom", ExternalType: "department", ExternalID: "8", LocalID: managed.ID,
	}).Error; err != nil {
		t.Fatal(err)
	}

	configRepo := repository.NewConfigRepository(db)
	if err := configRepo.Set("directory_sync", "platform_type", "wecom"); err != nil {
		t.Fatal(err)
	}
	if err := configRepo.Set("directory_sync", "mount_department_id", mount.ID.String()); err != nil {
		t.Fatal(err)
	}
	if err := configRepo.Set("directory_sync", "department_mappings", `[{"remote_path":"/北区"}]`); err != nil {
		t.Fatal(err)
	}

	svc := &DirectorySyncService{db: db, configRepo: configRepo}
	result, err := svc.ResetManagedDepartments()
	if err != nil {
		t.Fatal(err)
	}
	if result.DepartmentsDeleted != 1 || result.BindingsDeleted != 1 {
		t.Fatalf("unexpected reset result: %+v", result)
	}
	if err := db.First(&manualChild, "id = ?", manualChild.ID).Error; err != nil {
		t.Fatalf("manual child was deleted: %v", err)
	}
	if manualChild.ParentID == nil || *manualChild.ParentID != mount.ID {
		t.Fatalf("manual child was not moved to mount: %+v", manualChild)
	}
	if got := configRepo.Get("directory_sync", "department_mappings"); got != "[]" {
		t.Fatalf("mappings were not cleared: %s", got)
	}
}
