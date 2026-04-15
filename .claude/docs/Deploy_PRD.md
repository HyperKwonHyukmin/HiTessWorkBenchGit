PRD: 사내 서버 자동 배포 파이프라인 구축

개요

- 작성일: 2026-04-05
- 작성자: 권혁민
- 목적: 개인 PC에서 개발한 서버/클라이언트 앱을 사내 서버에 효율적으로 배포하는 자동화 파이프라인 구축
- 적용 범위: 서버 앱 (복잡한 환경 포함: npm, pip, 로컬 LLM 등) + 클라이언트 앱 배포

배경 및 문제 정의

현재 개인 PC에서 서버/클라이언트를 모두 개발하고, 런칭 시 서버 컴퓨터에 수동으로 이식하는 방식을 사용 중이다.
이 과정에서 다음 문제가 반복적으로 발생한다.

- 수동 배포로 인한 시간 낭비 및 실수 가능성
- npm, pip, LLM 모델 등 복잡한 환경 이식 시 "내 컴에선 되는데 서버에서 안 됨" 문제
- 업데이트/보수 시마다 환경 재구성 필요

목표

- git push 한 번으로 서버 배포까지 자동 완료
- 환경 차이 문제 구조적 제거
- LLM 모델 등 대용량 파일은 최초 1회 세팅 후 유지

기술 스택 선택

구성 요소
선택
이유
소스 관리
사내 GitLab
이미 사용 중
CI/CD
GitLab CI (self-hosted runner)
사내망 완전 동작
환경 이식

Docker + docker-compose
환경 100% 재현 보장
대용량 파일
Docker Volume
코드 배포와 분리


시스템 아키텍처

[개인 PC]
  코드 수정 → git push
                  ↓
[사내 GitLab]
  push 감지 → CI 파이프라인 자동 실행
                  ↓
[서버 PC] ← self-hosted runner 설치됨
  git pull → docker build → docker-compose up -d

구현 명세

1. Dockerfile

FROM python:3.11-slim

# Node.js 설치
RUN apt-get update && apt-get install -y nodejs npm

# Python 패키지
COPY requirements.txt .
RUN pip install -r requirements.txt

# Node 패키지
COPY package.json package-lock.json ./
RUN npm ci

COPY ./app /app
WORKDIR /app
CMD ["python", "server.py"]

GPU 사용 LLM의 경우 nvidia-container-toolkit 설치 및 compose 설정 추가 필요

2. docker-compose.yml

services:
  myapp:
    image: myapp:latest
    ports:
      - "8080:8080"
    volumes:
      - /data/llm_models:/app/models   # LLM 모델: 최초 1회 세팅
      - /data/appdata:/app/data
    restart: unless-stopped

3. .gitlab-ci.yml

stages:
  - build
  - deploy

build:
  stage: build
  tags: [my-server]
  script:
    - docker build -t myapp:$CI_COMMIT_SHORT_SHA .
    - docker tag myapp:$CI_COMMIT_SHORT_SHA myapp:latest

deploy:
  stage: deploy
  tags: [my-server]
  script:
    - docker-compose pull
    - docker-compose up -d --remove-orphans
  only:
    - main

4. GitLab Runner 설치 (서버 PC, Linux 기준)

curl -L https://packages.gitlab.com/install/repositories/runner/gitlab-runner/script.deb.sh | sudo bash
sudo apt install gitlab-runner
sudo gitlab-runner register  # GitLab 주소 + 토큰 입력

LLM 모델 파일 처리 전략

- 모델 파일 (수십 GB)은 Docker 이미지에 포함하지 않음
- Volume으로 서버 특정 경로에 고정 마운트
- 코드/패키지 업데이트와 모델 업데이트를 완전히 분리
- 모델 교체 시에만 서버 접속하여 해당 경로 파일 교체 후 컨테이너 재시작

평상시 운영 루틴

# 코드/환경 업데이트
코드 수정 → git commit → git push → 자동 배포 완료

# LLM 모델 교체 (드물게)
서버 접속 → /data/llm_models/ 파일 교체 → docker-compose restart

도입 순서 (Task)

[ ] Step 1: 개인 PC에서 Dockerfile 작성 + 로컬 동작 확인 (1~2일)
[ ] Step 2: 서버에 Docker + GitLab Runner 설치 (반나절)
[ ] Step 3: .gitlab-ci.yml 작성 + push 테스트 (반나절)
[ ] Step 4: LLM 모델 Volume 경로 세팅 (1~2시간)
[ ] Step 5: 전체 파이프라인 검증 및 문서화

Claude Code 실행 참고

이 PRD를 바탕으로 Claude Code에서 아래 순서로 진행 가능:

1. Dockerfile 생성 요청
2. docker-compose.yml 생성 요청
3. .gitlab-ci.yml 생성 요청
4. 서버 Runner 등록 명령어 확인
5. 각 파일을 프로젝트 루트에 배치 후 git push로 파이프라인 테스트

태그

#DevOps #Docker #GitLabCI #배포자동화 #사내인프라 #HiTESS
