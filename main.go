package main

import (
	"embed"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func databaseURL() string {
	if url := os.Getenv("DATABASE_URL"); url != "" {
		return url
	}
	// Fallback: a config file next to the XDG config dir (created by run.sh).
	dir, err := os.UserConfigDir()
	if err == nil {
		p := filepath.Join(dir, "tracka-desktop", "database_url")
		if b, err := os.ReadFile(p); err == nil {
			if s := strings.TrimSpace(string(b)); s != "" {
				return s
			}
		}
	}
	return ""
}

func main() {
	// 1. Initialize local SQLite database cache (offline-first primary store)
	localPath, err := defaultLocalDBPath()
	if err != nil {
		log.Fatalf("Could not determine local database path: %v", err)
	}
	localDB, err := openLocalDB(localPath)
	if err != nil {
		log.Fatalf("Could not initialize local SQLite database at %s: %v", localPath, err)
	}
	defer localDB.Close()

	// 2. Neon cloud connection URL (optional / non-blocking)
	cloudURL := databaseURL()

	// 3. Create service backed by local SQLite
	svc := NewTrackaServiceWithDB(localDB, localPath, cloudURL)

	// 4. Background cloud connection & synchronization (never blocks UI startup)
	if cloudURL != "" {
		go func() {
			cloudDB, err := pgOpenDB(cloudURL)
			if err != nil {
				log.Printf("[sync] background cloud connection postponed: %v", err)
				return
			}
			svc.SetCloudDB(cloudDB)
			if ok, err := svc.SyncNow(); err != nil {
				log.Printf("[sync] initial sync error: %v", err)
			} else if ok {
				log.Printf("[sync] initial sync complete")
			}
		}()
	} else {
		log.Printf("[sync] DATABASE_URL not set — running in local-only offline mode")
	}

	app := application.New(application.Options{
		Name:        "Tracka",
		Description: "Class and earnings tracker for private tutors",
		Services: []application.Service{
			application.NewService(svc),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:     "Tracka",
		Width:     1180,
		Height:    760,
		MinWidth:  960,
		MinHeight: 600,
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 50,
			Backdrop:                application.MacBackdropTranslucent,
			TitleBar:                application.MacTitleBarHiddenInset,
		},
		BackgroundColour: application.NewRGB(9, 9, 11),
		URL:              "/",
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
