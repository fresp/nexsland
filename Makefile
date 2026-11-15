UUID = nexsland@fresp.github.io
INSTALL_PATH = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
VERSION_NAME ?= $(shell git describe --tags --always --dirty 2>/dev/null)

SHELL := /bin/bash
.SHELLFLAGS := -eo pipefail -c
.NOTPARALLEL:

.PHONY: all build dist install uninstall enable disable check lint test clean nested log

all: build

schemas/gschemas.compiled: schemas/*.gschema.xml
	glib-compile-schemas --strict schemas

build: clean schemas/gschemas.compiled
	mkdir -p temp
	cp -r lib schemas extension.js prefs.js stylesheet.css metadata.json LICENSE temp/
	@if [ -n "$(VERSION_NAME)" ]; then \
		python3 -c "import json,sys; p='temp/metadata.json'; d=json.load(open(p)); d['version-name']=sys.argv[1]; json.dump(d,open(p,'w'),indent=2)" "$(VERSION_NAME)"; \
	fi

# The extensions.gnome.org package. GNOME 44+ compiles schemas on install, so the
# compiled file is left out (reviewers ask for that); `make install` keeps it.
dist: build
	rm -f temp/schemas/gschemas.compiled
	cd temp && zip -qr "../$(UUID).zip" .
	@unzip -l "$(UUID).zip" | grep -q 'schemas/org.gnome.shell.extensions.nexsland.gschema.xml' || { echo "dist: zip is missing the schema"; exit 1; }
	@! unzip -l "$(UUID).zip" | grep -q 'gschemas.compiled' || { echo "dist: zip must not contain gschemas.compiled"; exit 1; }

install: build
	rm -rf $(INSTALL_PATH)
	mkdir -p $(INSTALL_PATH)
	cp -r temp/* $(INSTALL_PATH)

uninstall:
	rm -rf $(INSTALL_PATH)

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

# Wayland: test in a nested shell instead of logging out. GNOME 49 replaced
# --nested with --devkit (needs the mutter-devkit viewer installed).
nested: install
	@if gnome-shell --help 2>&1 | grep -q -- '--devkit'; then \
		dbus-run-session -- gnome-shell --devkit --wayland; \
	else \
		dbus-run-session -- gnome-shell --nested --wayland; \
	fi

log:
	journalctl -f -o cat /usr/bin/gnome-shell | grep --line-buffered -i nexsland

lint:
	npm run lint
	npm run lint:src

test:
	npm test

# The gate every change must pass.
check: lint test
	glib-compile-schemas --strict --dry-run schemas

clean:
	rm -rf temp "$(UUID).zip" schemas/gschemas.compiled
