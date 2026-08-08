/**
 * html2canvas を用いた画面キャプチャ・レポート画像ダウンロード。
 */
const Report = (() => {
  async function captureAndDownload() {
    const target = document.getElementById("app");
    const loading = document.getElementById("map-loading");
    loading.classList.remove("hidden");
    try {
      const canvas = await html2canvas(target, { useCORS: true, allowTaint: true, scale: 1.5 });
      const link = document.createElement("a");
      const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
      link.download = `商圏レポート_${ts}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch (err) {
      alert("レポート画像の生成に失敗しました: " + err.message);
    } finally {
      loading.classList.add("hidden");
    }
  }

  return { captureAndDownload };
})();
