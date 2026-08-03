#!/bin/bash
# PMA Docker Offline Package Builder
# Builds a Docker image and exports it as a portable tar.gz for offline deployment.
# The build machine needs Docker + internet. The target server only needs Docker.
#
# Usage: bash scripts/docker-build.sh [OPTIONS]
set -e
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

usage() {
    echo ""
    echo -e "${CYAN}PMA Docker Offline Package Builder${NC}"
    echo ""
    echo "构建 Docker 镜像并导出为离线部署包。构建机需 Docker + 网络。"
    echo "目标服务器只需 Docker（无需 Python/pip/编译工具）。"
    echo ""
    echo -e "${CYAN}用法:${NC}"
    echo "  bash scripts/docker-build.sh [OPTIONS]"
    echo ""
    echo -e "${CYAN}选项:${NC}"
    echo "  --python VERSION  镜像的 Python 版本（默认 3.10）"
    echo "  --tag TAG         Docker 镜像标签（默认 pma:latest）"
    echo "  --skip-upload     跳过 GitLab Container Registry 上传"
    echo "  -h, --help        显示此帮助信息"
    echo ""
    echo -e "${CYAN}示例:${NC}"
    echo "  bash scripts/docker-build.sh                                    # 默认 Python 3.10"
    echo "  bash scripts/docker-build.sh --python 3.12 --tag pma:v2.0       # 指定版本+标签"
    echo "  bash scripts/docker-build.sh --skip-upload                      # 仅本地构建"
    echo ""
    echo -e "${CYAN}产出:${NC}"
    echo "  pma-docker-<版本号>.tar.gz"
    echo "  内含: pma-image.tar.gz + docker-compose.prod.yml + .env.example + install.sh"
    echo ""
    exit 0
}

# Parse options
PYTHON_VERSION="3.10"
IMAGE_TAG="pma:latest"
SKIP_UPLOAD=false
while [ $# -gt 0 ]; do
    case "$1" in
        -h|--help) usage ;;
        --python) PYTHON_VERSION="$2"; shift 2 ;;
        --tag) IMAGE_TAG="$2"; shift 2 ;;
        --skip-upload) SKIP_UPLOAD=true; shift ;;
        *) echo -e "${RED}未知参数: $1${NC}"; echo "使用 -h 查看帮助"; exit 1 ;;
    esac
done

echo ""
echo -e "${CYAN}══════════════════════════════════════════${NC}"
echo -e "${CYAN}  PMA Docker Offline Package Builder${NC}"
echo -e "${CYAN}══════════════════════════════════════════${NC}"
echo ""

# ── 1. Check Docker ──
echo -n "Checking Docker... "
if ! docker version --format '{{.Server.Version}}' >/dev/null 2>&1; then
    echo -e "${RED}FAILED${NC}"
    echo -e "${RED}[ERROR] Docker required but not available.${NC}"
    exit 1
fi
echo -e "${GREEN}$(docker version --format '{{.Server.Version}}')${NC}"

# ── 2. Get version ──
BUILD_TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
BUILD_VERSION=$(date '+%Y%m%d-%H%M%S')
APP_VERSION=""
if [ -f "$PROJECT_ROOT/frontend/index.html" ]; then
    APP_VERSION=$(grep -oP '<meta name="app-version" content="\K[^"]*' "$PROJECT_ROOT/frontend/index.html" 2>/dev/null || true)
fi
BUILD_VERSION="${APP_VERSION:-$BUILD_VERSION}"
echo "Python:    $PYTHON_VERSION"
echo "Image tag: $IMAGE_TAG"
echo "Version:   $BUILD_VERSION"

# ── 3. Docker build ──
echo ""
echo -e "${CYAN}[1/3] Building Docker image...${NC}"
echo "  (apt/pip packages cached — only new dependencies trigger network downloads)"
export DOCKER_BUILDKIT=1
docker build \
    --build-arg PYTHON_VERSION="$PYTHON_VERSION" \
    -t "$IMAGE_TAG" \
    --progress=plain \
    . 2>&1 | while IFS= read -r line; do
    echo "  $line"
done

# Verify image was built successfully
if ! docker image inspect "$IMAGE_TAG" >/dev/null 2>&1; then
    echo -e "  ${RED}FAILED${NC}"
    echo -e "${RED}[ERROR] Docker build failed — no image produced.${NC}"
    echo "  Check the build output above for the error."
    exit 1
fi
IMAGE_SIZE=$(docker image inspect "$IMAGE_TAG" --format='{{.Size}}' | awk '{printf "%.0fM", $1/1024/1024}')
echo -e "  ${GREEN}OK${NC} Image: $IMAGE_TAG ($IMAGE_SIZE)"

# ── 4. Export image ──
echo ""
echo -e "${CYAN}[2/3] Exporting Docker image...${NC}"

BUILD_DIR="$SCRIPT_DIR/build/docker-package"
rm -rf "$SCRIPT_DIR/build"
mkdir -p "$BUILD_DIR"

IMAGE_FILE="pma-image.tar.gz"
echo -n "  Saving $IMAGE_FILE... "
docker save "$IMAGE_TAG" | gzip > "$BUILD_DIR/$IMAGE_FILE"
IMAGE_SIZE=$(du -h "$BUILD_DIR/$IMAGE_FILE" | cut -f1)
echo -e "${GREEN}done${NC} ($IMAGE_SIZE)"

# ── 5. Package deployment files ──
echo ""
echo -e "${CYAN}[3/3] Packaging deployment files...${NC}"

# Production compose file
cp "$PROJECT_ROOT/docker-compose.prod.yml" "$BUILD_DIR/docker-compose.yml"
echo "  docker-compose.yml"

# Env template
cp "$PROJECT_ROOT/.env.example" "$BUILD_DIR/.env.example"
echo "  .env.example"

# Generate install.sh from template
sed -e "s|{{BUILD_TIMESTAMP}}|$BUILD_TIMESTAMP|g" \
    -e "s|{{BUILD_VERSION}}|$BUILD_VERSION|g" \
    -e "s|{{IMAGE_TAG}}|$IMAGE_TAG|g" \
    "$SCRIPT_DIR/install.sh.template" > "$BUILD_DIR/install.sh"
chmod +x "$BUILD_DIR/install.sh"
echo "  install.sh"

# ── 6. Create archive ──
PY_VER=$(echo "$PYTHON_VERSION" | tr -d '.')
ARCHIVE_NAME="pma-docker-py${PY_VER}-${BUILD_VERSION}.tar.gz"
ARCHIVE_PATH="$PROJECT_ROOT/$ARCHIVE_NAME"
rm -f "$ARCHIVE_PATH"

echo ""
echo -n "Creating $ARCHIVE_NAME... "
cd "$SCRIPT_DIR/build"
tar czf "$ARCHIVE_PATH" "docker-package/"
cd "$PROJECT_ROOT"
ARCHIVE_SIZE=$(du -h "$ARCHIVE_PATH" | cut -f1)
echo -e "${GREEN}done${NC} ($ARCHIVE_SIZE)"

# ── 7. Upload to GitLab Container Registry ──
if [ "$SKIP_UPLOAD" = false ]; then
    upload_to_registry() {
        local gitlab_url gitlab_token gitlab_project
        if [ -f "$PROJECT_ROOT/.env" ]; then
            gitlab_url=$(grep "^GITLAB_BASE_URL=" "$PROJECT_ROOT/.env" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
            gitlab_token=$(grep "^GITLAB_TOKEN=" "$PROJECT_ROOT/.env" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
            gitlab_project=$(grep "^GITLAB_PROJECT_PATH=" "$PROJECT_ROOT/.env" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
        fi
        if [ -z "$gitlab_url" ] || [ -z "$gitlab_token" ] || [ -z "$gitlab_project" ]; then
            echo ""
            echo -e "${YELLOW}[SKIP]${NC} GitLab not configured (need GITLAB_BASE_URL, GITLAB_TOKEN, GITLAB_PROJECT_PATH)"
            return 0
        fi

        local gitlab_host=$(echo "$gitlab_url" | sed 's|/api/v4||')
        local registry="${gitlab_host#http://}:5050"
        local registry_image="${registry}/${gitlab_project}/pma:${BUILD_VERSION}"

        echo ""
        echo "Pushing to GitLab Container Registry..."
        echo "  Registry: $registry"

        docker tag "$IMAGE_TAG" "$registry_image"
        echo "$gitlab_token" | docker login "$registry" -u gitlab-ci-token --password-stdin >/dev/null 2>&1
        docker push "$registry_image" 2>&1 | while IFS= read -r line; do
            echo "  $line"
        done
        echo ""
        echo "  Pull on target: docker pull $registry_image"
    }
    upload_to_registry
else
    echo ""
    echo -e "${YELLOW}[SKIP]${NC} Registry upload skipped"
fi

# ── 8. Cleanup ──
rm -rf "$SCRIPT_DIR/build"

# ── Done ──
echo ""
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo -e "${GREEN}  Build Complete${NC}"
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo ""
echo "  Package:  $ARCHIVE_PATH ($ARCHIVE_SIZE)"
echo "  Image:    $IMAGE_TAG"
echo ""
echo "  Deploy on target server:"
echo "    scp $ARCHIVE_NAME user@target:/opt/"
echo "    ssh user@target"
echo "    cd /opt && tar xzf $ARCHIVE_NAME"
echo "    cd docker-package && sudo bash install.sh"
echo ""
