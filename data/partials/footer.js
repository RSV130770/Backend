/* ============================================================
FOOTER SECTION
 ============================================================ */


document.getElementById("footer-prev").addEventListener("click", e => {
  e.preventDefault();
  e.stopImmediatePropagation();   // ← FIX
  const idx = pageOrder.indexOf(currentPage);
  if (idx > 0) showPage(pageOrder[idx - 1]);
});

document.getElementById("footer-next").addEventListener("click", e => {
  e.preventDefault();
  e.stopImmediatePropagation();   // ← FIX
  const idx = pageOrder.indexOf(currentPage);
  if (idx < pageOrder.length - 1) showPage(pageOrder[idx + 1]);
});

