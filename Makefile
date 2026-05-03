.DEFAULT_GOAL := help

SHELL := /bin/bash

PORT ?= 20128
HOSTNAME ?= 0.0.0.0
BASE_URL ?= http://localhost:$(PORT)
NEXT_PUBLIC_BASE_URL ?= $(BASE_URL)
TEST_DIR ?= tests
TMP_NODE_MODULES ?= /tmp/node_modules
VITEST_BIN ?= $(TMP_NODE_MODULES)/.bin/vitest
TEST_FILE ?=
DOCKER_IMAGE ?= 9router
DOCKER_CONTAINER ?= 9router
DOCKER_DATA_DIR ?= $(HOME)/.9router
CLOUD_DIR ?= cloud

APP_ENV = BASE_URL="$(BASE_URL)" NEXT_PUBLIC_BASE_URL="$(NEXT_PUBLIC_BASE_URL)"
START_ENV = PORT="$(PORT)" HOSTNAME="$(HOSTNAME)" $(APP_ENV)
TEST_ENV = NODE_PATH="$(TMP_NODE_MODULES)"

.PHONY: \
	help \
	print-vars \
	install \
	dev \
	build \
	start \
	lint \
	dev-bun \
	build-bun \
	start-bun \
	test-setup \
	test \
	test-watch \
	test-file \
	docker-build \
	docker-run \
	docker-run-bg \
	docker-stop \
	docker-logs \
	cloud-install \
	cloud-dev \
	cloud-deploy

help: ## Show available Make targets
	@printf "\nUsage: make <target> [VAR=value]\n\n"
	@printf "App\n"
	@printf "  %-18s %s\n" "install" "Install root dependencies"
	@printf "  %-18s %s\n" "dev" "Run Next.js dev server via npm script (currently script-pinned to port 20128)"
	@printf "  %-18s %s\n" "build" "Build the app"
	@printf "  %-18s %s\n" "start" "Start the production server"
	@printf "  %-18s %s\n" "lint" "Run eslint"
	@printf "  %-18s %s\n" "dev-bun" "Run bun-based dev server"
	@printf "  %-18s %s\n" "build-bun" "Run bun-based build"
	@printf "  %-18s %s\n" "start-bun" "Run bun-based production server"
	@printf "\nTests\n"
	@printf "  %-18s %s\n" "test-setup" "Install Vitest into /tmp/node_modules"
	@printf "  %-18s %s\n" "test" "Run test suite from tests/"
	@printf "  %-18s %s\n" "test-watch" "Watch tests from tests/"
	@printf "  %-18s %s\n" "test-file" "Run one test file with TEST_FILE=unit/foo.test.js"
	@printf "\nDocker\n"
	@printf "  %-18s %s\n" "docker-build" "Build Docker image"
	@printf "  %-18s %s\n" "docker-run" "Run Docker container in foreground"
	@printf "  %-18s %s\n" "docker-run-bg" "Run Docker container in background"
	@printf "  %-18s %s\n" "docker-stop" "Stop named Docker container if running"
	@printf "  %-18s %s\n" "docker-logs" "Follow container logs"
	@printf "\nCloud\n"
	@printf "  %-18s %s\n" "cloud-install" "Install cloud worker dependencies"
	@printf "  %-18s %s\n" "cloud-dev" "Run Cloudflare worker locally"
	@printf "  %-18s %s\n" "cloud-deploy" "Deploy Cloudflare worker"
	@printf "\nUtility\n"
	@printf "  %-18s %s\n" "print-vars" "Print resolved Makefile variables"
	@printf "\nExamples\n"
	@printf "  make dev\n"
	@printf "  make start PORT=20129\n"
	@printf "  make test-file TEST_FILE=unit/usageDb-cached-tokens.test.js\n"
	@printf "  make docker-run-bg DOCKER_CONTAINER=n9router-dev\n"
	@printf "\n"

print-vars: ## Print resolved Makefile variables
	@printf "PORT=%s\n" "$(PORT)"
	@printf "HOSTNAME=%s\n" "$(HOSTNAME)"
	@printf "BASE_URL=%s\n" "$(BASE_URL)"
	@printf "NEXT_PUBLIC_BASE_URL=%s\n" "$(NEXT_PUBLIC_BASE_URL)"
	@printf "TEST_DIR=%s\n" "$(TEST_DIR)"
	@printf "TMP_NODE_MODULES=%s\n" "$(TMP_NODE_MODULES)"
	@printf "VITEST_BIN=%s\n" "$(VITEST_BIN)"
	@printf "DOCKER_IMAGE=%s\n" "$(DOCKER_IMAGE)"
	@printf "DOCKER_CONTAINER=%s\n" "$(DOCKER_CONTAINER)"
	@printf "DOCKER_DATA_DIR=%s\n" "$(DOCKER_DATA_DIR)"
	@printf "CLOUD_DIR=%s\n" "$(CLOUD_DIR)"

install: ## Install root dependencies
	$(APP_ENV) npm install

dev: ## Run Next.js dev server via npm script
	@printf "Note: root npm script currently hardcodes --port 20128; PORT=%s may not take effect here.\n" "$(PORT)"
	$(APP_ENV) npm run dev

build: ## Build the app
	$(APP_ENV) npm run build

start: ## Start the production server
	$(START_ENV) npm run start

lint: ## Run eslint
	npx eslint .

dev-bun: ## Run bun-based dev server
	@printf "Note: root bun dev script currently hardcodes --port 20128; PORT=%s may not take effect here.\n" "$(PORT)"
	$(APP_ENV) npm run dev:bun

build-bun: ## Run bun-based build
	$(APP_ENV) npm run build:bun

start-bun: ## Run bun-based production server
	$(START_ENV) npm run start:bun

test-setup: ## Install Vitest into /tmp/node_modules
	cd /tmp && npm install vitest

define require-vitest
	@if [ ! -x "$(VITEST_BIN)" ]; then \
		printf "Vitest not found at %s\nRun: make test-setup\n" "$(VITEST_BIN)"; \
		exit 1; \
	fi
endef

test: ## Run test suite from tests/
	$(require-vitest)
	cd "$(TEST_DIR)" && npm test

test-watch: ## Watch tests from tests/
	$(require-vitest)
	cd "$(TEST_DIR)" && npm run test:watch

test-file: ## Run one test file with TEST_FILE=unit/foo.test.js
	@if [ -z "$(TEST_FILE)" ]; then \
		printf "TEST_FILE is required\nExample: make test-file TEST_FILE=unit/usageDb-cached-tokens.test.js\n"; \
		exit 1; \
	fi
	$(require-vitest)
	cd "$(TEST_DIR)" && $(TEST_ENV) "$(VITEST_BIN)" run "$(TEST_FILE)" --reporter=verbose

docker-build: ## Build Docker image
	docker build -t "$(DOCKER_IMAGE)" .

docker-run: ## Run Docker container in foreground
	docker run --rm \
	  -p "$(PORT):20128" \
	  -v "$(DOCKER_DATA_DIR):/app/data" \
	  -e DATA_DIR=/app/data \
	  -e PORT=20128 \
	  -e HOSTNAME=0.0.0.0 \
	  --name "$(DOCKER_CONTAINER)" \
	  "$(DOCKER_IMAGE)"

docker-run-bg: ## Run Docker container in background
	docker run -d \
	  -p "$(PORT):20128" \
	  -v "$(DOCKER_DATA_DIR):/app/data" \
	  -e DATA_DIR=/app/data \
	  -e PORT=20128 \
	  -e HOSTNAME=0.0.0.0 \
	  --name "$(DOCKER_CONTAINER)" \
	  "$(DOCKER_IMAGE)"

docker-stop: ## Stop named Docker container if running
	@if docker ps -q --filter "name=^$(DOCKER_CONTAINER)$$" | grep -q .; then \
		docker stop "$(DOCKER_CONTAINER)"; \
	else \
		printf "Container %s is not running\n" "$(DOCKER_CONTAINER)"; \
	fi

docker-logs: ## Follow container logs
	docker logs -f "$(DOCKER_CONTAINER)"

cloud-install: ## Install cloud worker dependencies
	cd "$(CLOUD_DIR)" && npm install

cloud-dev: ## Run Cloudflare worker locally
	cd "$(CLOUD_DIR)" && npm run dev

cloud-deploy: ## Deploy Cloudflare worker
	cd "$(CLOUD_DIR)" && npm run deploy
