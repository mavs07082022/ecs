/* ============================================================
   Culiat Public Safety — Shared design-system JS (v3)
   ============================================================ */

(function () {
  "use strict";

  const THEME_KEY = "culiat-ecs-theme";

  function getInitialTheme() {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "dark" || stored === "light") return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyTheme(theme) {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem(THEME_KEY, theme);
  }

  function updateToggleIcons(theme) {
    document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
      const sun = btn.querySelector("[data-icon='sun']");
      const moon = btn.querySelector("[data-icon='moon']");
      if (!sun || !moon) return;
      if (theme === "dark") {
        sun.classList.add("hidden-icon");
        moon.classList.remove("hidden-icon");
      } else {
        sun.classList.remove("hidden-icon");
        moon.classList.add("hidden-icon");
      }
      btn.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
    });
  }

  // Apply before DOM ready
  const initialTheme = getInitialTheme();
  document.documentElement.classList.toggle("dark", initialTheme === "dark");

  function initTheme() {
    updateToggleIcons(getInitialTheme());
    document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
      if (btn.dataset.themeBound) return;
      btn.dataset.themeBound = "1";
      btn.addEventListener("click", () => {
        const current = document.documentElement.classList.contains("dark") ? "dark" : "light";
        const next = current === "dark" ? "light" : "dark";
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const sVT = document.startViewTransition;

        if (sVT && !reduced) {
          const rect = btn.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          const R = Math.hypot(
            Math.max(x, window.innerWidth - x),
            Math.max(y, window.innerHeight - y)
          );
          const transition = sVT.call(document, () => {
            applyTheme(next);
            updateToggleIcons(next);
          });
          transition.ready.then(() => {
            document.documentElement.animate(
              { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${R}px at ${x}px ${y}px)`] },
              {
                duration: 1150,
                easing: "cubic-bezier(0.65, 0, 0.35, 1)",
                pseudoElement: "::view-transition-new(root)",
              }
            );
          });
        } else {
          document.documentElement.classList.add("theme-transition");
          applyTheme(next);
          updateToggleIcons(next);
          setTimeout(() => document.documentElement.classList.remove("theme-transition"), 500);
        }
      });
    });
  }

  function initReveal() {
    const elements = Array.from(document.querySelectorAll("[data-reveal]"));
    if (!elements.length) return;
    if (!("IntersectionObserver" in window)) {
      elements.forEach((el) => el.setAttribute("data-visible", "true"));
      return;
    }
    document.documentElement.classList.add("reveal-ready");
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) =>
          entry.target.setAttribute("data-visible", entry.isIntersecting ? "true" : "false")
        ),
      { threshold: 0.12, rootMargin: "0px 0px -40px" }
    );
    elements.forEach((el) => observer.observe(el));
  }

  function initLucide() {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    initReveal();
    initLucide();
  });

  window.CuliatDesign = { initReveal, initLucide, applyTheme, getInitialTheme, updateToggleIcons };
})();
