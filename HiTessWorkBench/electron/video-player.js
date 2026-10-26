// 영상 전용 창 화면 스크립트. 재생 정보는 main 이 preload 로 넘겨 준다.
(function () {
  const stage = document.getElementById("stage");
  const video = document.getElementById("video");
  const roam = document.getElementById("roam");
  const corner = document.getElementById("corner");
  const fsButton = document.getElementById("fs");
  const message = document.getElementById("message");

  const showMessage = (text) => {
    message.textContent = text;
    message.style.display = "flex";
  };

  // 우클릭 메뉴(영상 저장·주소 복사)와 끌어다 놓기를 막는다.
  document.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("dragstart", (e) => e.preventDefault());

  // 전체 화면은 영상이 아니라 무대(영상+워터마크)째로 — 영상만 전체 화면이면 워터마크가 사라진다.
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else stage.requestFullscreen().catch(() => {});
  };
  fsButton.addEventListener("click", toggleFullscreen);
  video.addEventListener("dblclick", (e) => { e.preventDefault(); toggleFullscreen(); });
  document.addEventListener("fullscreenchange", () => {
    fsButton.textContent = document.fullscreenElement ? "전체 화면 끝내기" : "전체 화면";
  });

  // 떠다니는 워터마크 — 18초마다 자리를 옮겨 한 곳을 잘라 내도 남게 한다.
  const moveMark = () => {
    const maxX = Math.max(0, stage.clientWidth - roam.offsetWidth - 24);
    const maxY = Math.max(0, stage.clientHeight - roam.offsetHeight - 80);
    roam.style.left = `${12 + Math.random() * maxX}px`;
    roam.style.top = `${12 + Math.random() * maxY}px`;
  };

  window.videoHost.getInfo().then((info) => {
    if (!info || !info.url) {
      showMessage("재생 정보를 받지 못했습니다. WorkBench 에서 영상을 다시 열어 주세요.");
      return;
    }
    document.title = info.title;
    const stamp = new Date().toLocaleDateString("ko-KR");
    roam.textContent = `${info.watermark}  ${stamp}`;
    corner.textContent = `HiTESS · ${info.watermark}`;
    moveMark();
    setInterval(moveMark, 18000);
    window.addEventListener("resize", moveMark);
    video.addEventListener("error", () => {
      showMessage("영상을 재생할 수 없습니다. 재생 시간이 지났거나 서버에 연결할 수 없습니다.\nWorkBench 에서 영상을 다시 열어 주세요.");
    });
    video.src = info.url;
  }).catch(() => showMessage("재생 정보를 받지 못했습니다. WorkBench 에서 영상을 다시 열어 주세요."));
})();
