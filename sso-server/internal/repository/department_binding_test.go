package repository

import (
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"sso-server/internal/model"
)

func TestDepartmentDeleteCleansDirectoryBinding(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Department{}, &model.DirectorySyncBinding{}); err != nil {
		t.Fatal(err)
	}
	dept := model.Department{Name: "北区"}
	if err := db.Create(&dept).Error; err != nil {
		t.Fatal(err)
	}
	binding := model.DirectorySyncBinding{
		Provider:     "wecom",
		ExternalType: "department",
		ExternalID:   "8",
		LocalID:      dept.ID,
	}
	if err := db.Create(&binding).Error; err != nil {
		t.Fatal(err)
	}

	if err := NewDepartmentRepository(db).Delete(dept.ID); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&model.DirectorySyncBinding{}).Where("local_id = ?", dept.ID).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("expected binding cleanup, found %d", count)
	}
}
