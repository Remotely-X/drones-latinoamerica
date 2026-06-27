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

const forumList = document.querySelector("[data-forum-list]");

if (forumList) {
  const base = forumList.dataset.forumBase;

  const renderItem = (title, replies, url) => {
    const link = document.createElement("a");
    link.className = "forum-item";
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    const icon = document.createElement("span");
    icon.className = "forum-icon";
    icon.setAttribute("aria-hidden", "true");

    const body = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = title;
    const small = document.createElement("small");
    small.textContent =
      replies === 1 ? "1 respuesta" : `${replies} respuestas`;
    body.append(strong, small);

    const chevron = document.createElement("em");
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "›";

    link.append(icon, body, chevron);
    return link;
  };

  const loadJson = (url) =>
    fetch(url).then((response) => {
      if (!response.ok) {
        throw new Error("No se pudo cargar el foro");
      }
      return response.json();
    });

  // 1) Archivo local generado por GitHub Actions (mismo dominio, sin CORS).
  // 2) Si no existe, se intenta el foro en vivo (puede fallar por CORS).
  loadJson("forum-latest.json")
    .catch(() => loadJson(`${base}/latest.json`))
    .then((data) => {
      const topics = (data?.topic_list?.topics || []).slice(0, 6);

      if (!topics.length) {
        throw new Error("Sin temas");
      }

      forumList.innerHTML = "";
      topics.forEach((topic) => {
        const replies = Math.max((topic.posts_count || 1) - 1, 0);
        const url = `${base}/t/${topic.slug}/${topic.id}`;
        forumList.append(renderItem(topic.title, replies, url));
      });
    })
    .catch(() => {
      forumList.innerHTML = "";
      const fallback = document.createElement("a");
      fallback.className = "forum-item";
      fallback.href = `${base}/latest`;
      fallback.target = "_blank";
      fallback.rel = "noopener noreferrer";

      const icon = document.createElement("span");
      icon.className = "forum-icon";
      icon.setAttribute("aria-hidden", "true");

      const body = document.createElement("span");
      const strong = document.createElement("strong");
      strong.textContent = "Visita nuestro foro en Discourse";
      const small = document.createElement("small");
      small.textContent = "Temas, preguntas y proyectos de la comunidad";
      body.append(strong, small);

      const chevron = document.createElement("em");
      chevron.setAttribute("aria-hidden", "true");
      chevron.textContent = "›";

      fallback.append(icon, body, chevron);
      forumList.append(fallback);
    });
}

const videoFilterButtons = document.querySelectorAll("[data-video-filter]");
const videosGrid = document.getElementById("videos-grid");
const videoCards = videosGrid?.querySelectorAll("[data-video-category]");
const videoEmptyMessage = document.querySelector("[data-video-empty]");
const videosSeeMoreButton = document.querySelector('[data-see-more="videos-grid"]');
let activeVideoCategory = "drones";
let areVideosExpanded = false;

const updateVideosSeeMoreState = (visibleCount) => {
  if (!videosSeeMoreButton) {
    return;
  }

  videosSeeMoreButton.parentElement?.toggleAttribute("hidden", visibleCount <= 3);
  videosSeeMoreButton.setAttribute("aria-expanded", String(areVideosExpanded));
  videosSeeMoreButton.textContent = areVideosExpanded
    ? videosSeeMoreButton.dataset.labelLess || "Ver menos"
    : videosSeeMoreButton.dataset.labelMore || "Ver todos los videos";
};

const applyVideoFilter = (category, { keepExpanded = false } = {}) => {
  if (!videosGrid || !videoCards) {
    return;
  }

  activeVideoCategory = category;
  if (!keepExpanded) {
    areVideosExpanded = false;
  }

  let visibleCount = 0;
  videoCards.forEach((card) => {
    const isVisible = card.getAttribute("data-video-category") === category;
    card.classList.toggle("is-hidden", !isVisible);
    if (isVisible) {
      visibleCount += 1;
      card.classList.toggle("is-over-limit", visibleCount > 3);
    } else {
      card.classList.remove("is-over-limit");
    }
  });

  videosGrid.classList.toggle("is-collapsed", !areVideosExpanded);
  videoEmptyMessage?.toggleAttribute("hidden", visibleCount > 0);
  updateVideosSeeMoreState(visibleCount);
};

document.querySelectorAll("[data-see-more]").forEach((button) => {
  button.addEventListener("click", () => {
    const grid = document.getElementById(button.getAttribute("data-see-more"));
    if (!grid) {
      return;
    }

    if (grid === videosGrid) {
      areVideosExpanded = !areVideosExpanded;
      applyVideoFilter(activeVideoCategory, { keepExpanded: true });
      return;
    }

    const isCollapsed = grid.classList.toggle("is-collapsed");
    button.setAttribute("aria-expanded", String(!isCollapsed));
    button.textContent = isCollapsed
      ? button.dataset.labelMore
      : button.dataset.labelLess;
  });
});

videoFilterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const category = button.getAttribute("data-video-filter");
    if (!category) {
      return;
    }

    videoFilterButtons.forEach((item) => {
      const isActive = item === button;
      item.classList.toggle("is-active", isActive);
      item.setAttribute("aria-pressed", String(isActive));
    });

    applyVideoFilter(category);
  });
});

applyVideoFilter(activeVideoCategory);
