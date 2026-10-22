.DEFAULT_GOAL := help

PROJECT ?= pasqualefiorillo-it
BRANCH ?= master
WRANGLER := npx --yes wrangler@4.152.0

.PHONY: help login build deploy

help:
	@echo "make login   Authenticate with Cloudflare"
	@echo "make build   Build the static site into dist/"
	@echo "make deploy  Build and publish to Cloudflare Pages"

login:
	$(WRANGLER) login

build:
	npm run build

deploy: build
	$(WRANGLER) pages deploy dist --project-name "$(PROJECT)" --branch "$(BRANCH)"
