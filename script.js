const header = document.querySelector("[data-header]");
const menuToggle = document.querySelector("[data-menu-toggle]");
const nav = document.querySelector("[data-nav]");
const searchToggle = document.querySelector("[data-search-toggle]");
const searchPanel = document.querySelector("[data-search-panel]");
const searchInput = document.querySelector("#site-search");
const navLinks = document.querySelectorAll(".main-nav a");

const setHeaderState = () => {
  header?.classList.toggle("is-scrolled", window.scrollY > 18);
};

setHeaderState();
window.addEventListener("scroll", setHeaderState, { passive: true });

menuToggle?.addEventListener("click", () => {
  const isOpen = nav?.classList.toggle("is-open");
  document.body.classList.toggle("menu-open", Boolean(isOpen));
  menuToggle.setAttribute("aria-expanded", String(Boolean(isOpen)));
});

navLinks.forEach((link) => {
  link.addEventListener("click", () => {
    navLinks.forEach((item) => item.classList.remove("is-active"));
    link.classList.add("is-active");
    nav?.classList.remove("is-open");
    document.body.classList.remove("menu-open");
    menuToggle?.setAttribute("aria-expanded", "false");
  });
});

searchToggle?.addEventListener("click", () => {
  const isOpen = searchPanel?.classList.toggle("is-open");
  searchToggle.setAttribute("aria-expanded", String(Boolean(isOpen)));
  if (isOpen) {
    window.setTimeout(() => searchInput?.focus(), 120);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    return;
  }

  searchPanel?.classList.remove("is-open");
  nav?.classList.remove("is-open");
  document.body.classList.remove("menu-open");
  searchToggle?.setAttribute("aria-expanded", "false");
  menuToggle?.setAttribute("aria-expanded", "false");
});

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const clickedSearch = target.closest("[data-search-panel], [data-search-toggle]");
  if (!clickedSearch) {
    searchPanel?.classList.remove("is-open");
    searchToggle?.setAttribute("aria-expanded", "false");
  }
});

searchPanel?.addEventListener("submit", (event) => {
  event.preventDefault();
  searchPanel.classList.remove("is-open");
  searchToggle?.setAttribute("aria-expanded", "false");
});

document.querySelectorAll("[data-see-more]").forEach((button) => {
  button.addEventListener("click", () => {
    const grid = document.getElementById(button.getAttribute("data-see-more"));
    if (!grid) {
      return;
    }

    const isCollapsed = grid.classList.toggle("is-collapsed");
    button.setAttribute("aria-expanded", String(!isCollapsed));
    button.textContent = isCollapsed
      ? button.dataset.labelMore
      : button.dataset.labelLess;
  });
});
