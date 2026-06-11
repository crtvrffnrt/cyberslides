(function () {
  const presentation = window.__PRESENTATION__ || {};
  const slides = Array.from(document.querySelectorAll(".slide"));
  const counter = document.getElementById("counter");
  const slideProgress = document.getElementById("slideProgress");
  const themeToggle = document.getElementById("themeToggle");
  const modeToggle = document.getElementById("modeToggle");
  const deck = document.getElementById("deck");
  const slideSelect = document.getElementById("slideSelect");
  const slideOrderList = document.getElementById("slideOrderList");
  const templateSelect = document.getElementById("templateSelect");
  const headingScaleInput = document.getElementById("headingScale");
  const bodyScaleInput = document.getElementById("bodyScale");
  const terminalSwap = document.getElementById("terminalSwap");
  const terminalSwapField = document.querySelector(".terminal-swap-field");
  const addSlide = document.getElementById("addSlide");
  const deleteSlide = document.getElementById("deleteSlide");
  const saveSlides = document.getElementById("saveSlides");
  const slideMarkdown = document.getElementById("slideMarkdown");
  const coverTitle = document.getElementById("coverTitle");
  const coverSubtitle = document.getElementById("coverSubtitle");
  const presenterName = document.getElementById("presenterName");
  const presenterRole = document.getElementById("presenterRole");
  const presenterContact = document.getElementById("presenterContact");
  const presenterWebsite = document.getElementById("presenterWebsite");
  const presenterGithub = document.getElementById("presenterGithub");
  const presenterLinkedin = document.getElementById("presenterLinkedin");
  const metadataDate = document.getElementById("metadataDate");
  const metadataVersion = document.getElementById("metadataVersion");
  const agendaInput = document.getElementById("agendaInput");
  const imageDrop = document.getElementById("imageDrop");
  const imageFile = document.getElementById("imageFile");
  const deleteImage = document.getElementById("deleteImage");
  const imageScale = document.getElementById("imageScale");
  const imageAlt = document.getElementById("imageAlt");
  const imageX = document.getElementById("imageX");
  const imageY = document.getElementById("imageY");
  const mustReadUrl = document.getElementById("mustReadUrl");
  const editorStatus = document.getElementById("editorStatus");
  const cameraToggle = document.getElementById("cameraToggle");
  const cameraPanel = document.getElementById("cameraPanel");
  const cameraSource = document.getElementById("cameraSource");
  const cameraMicrophone = document.getElementById("cameraMicrophone");
  const cameraPosition = document.getElementById("cameraPosition");
  const cameraSize = document.getElementById("cameraSize");
  const cameraZoom = document.getElementById("cameraZoom");
  const cameraEnable = document.getElementById("cameraEnable");
  const cameraDisable = document.getElementById("cameraDisable");
  const cameraStatus = document.getElementById("cameraStatus");
  const cameraOverlay = document.getElementById("cameraOverlay");
  const cameraVideo = document.getElementById("cameraVideo");
  const cameraQuickToggle = document.getElementById("cameraQuickToggle");
  const audioPrevious = document.getElementById("audioPrevious");
  const audioPlay = document.getElementById("audioPlay");
  const audioNext = document.getElementById("audioNext");
  const audioVolume = document.getElementById("audioVolume");
  const mermaidModulePath = "/node_modules/mermaid/dist/mermaid.esm.min.mjs";
  const minTypographyScale = 0.6;
  const maxTypographyScale = 1.8;
  const typographyScaleStep = 0.05;
  const terminalStates = new Map();
  const mermaidSources = new WeakMap();
  const coverFields = Array.from(document.querySelectorAll(".cover-field"));
  const contentFields = Array.from(document.querySelectorAll(".content-field"));
  const imageFields = Array.from(document.querySelectorAll(".image-field"));
  const reconnectBaseMs = 400;
  const reconnectMaxMs = 5000;
  const cameraSettingsStorageKey = `presentation-camera-settings:${window.location.pathname}`;
  let progressDots = [];
  let activeSlideRendered = false;
  let navigationFrame = 0;
  let pendingNavigationDelta = 0;
  let terminalFitFrame = 0;
  let imageRenderFrame = 0;
  let editorSaveFrame = 0;
  let mermaidRenderFrame = 0;
  let mermaidRenderToken = 0;
  let mermaidRuntimePromise = null;
  let mermaidDiagramCounter = 0;
  let slideOrderDragIndex = -1;
  let slideOrderDropIndex = -1;
  let slideOrderDropPosition = "";
  let slideOrderDirty = false;
  const pendingImageRenders = new Set();
  const imageDragState = {
    active: false,
    pointerId: null,
    index: -1,
    mode: "move",
    startClientX: 0,
    startClientY: 0,
    startX: 0,
    startY: 0,
    startScale: 1,
    stageRect: null,
    stage: null
  };
  const constraints = presentation.constraints || { minSlides: 1, maxSlides: 100 };
  let currentIndex = 0;
  let editorIndex = 0;
  let navigationDirection = "forward";
  let themeMode = "dark";
  let mode = "present";
  let cameraStream = null;
  let cameraEnabled = false;
  let cameraDevicesLoaded = false;
  let audioTracks = [];
  let audioIndex = 0;
  let audioElement = null;
  let audioLoaded = false;
  let audioDuckingContext = null;
  let audioDuckingFrame = 0;
  const initialTypographyDefaults = normalizeTypographyDefaults(presentation.defaults || {});
  let draftConfig = JSON.parse(JSON.stringify({
    title: presentation.title || "Presentation",
    theme: presentation.theme || {},
    defaults: initialTypographyDefaults,
    cover: presentation.cover || {},
    metadata: presentation.metadata || {},
    presenter: presentation.presenter || {},
    slides: presentation.slides || []
  }));
  let draftContentSlides = Array.isArray(presentation.contentSlides)
    ? presentation.contentSlides.slice()
    : slides.map((slide) => slide.textContent.trim());

  const templateDefaults = {
    terminalText: {
      markdown: "# Technical point\n\nOne short explanation.\n\n- Optional detail",
      config: {
        type: "terminalText",
        layout: "hero",
        terminal: {
          enabled: true,
          leftVw: 46,
          topVh: 10,
          widthVw: 48,
          heightVh: 83,
          position: "right",
          title: "Live Terminal"
        },
        mustReadUrl: ""
      }
    },
    text: {
      markdown: "# Focus statement\n\nOne short sentence.",
      config: {
        type: "text",
        layout: "center",
        terminal: { enabled: false },
        mustReadUrl: ""
      }
    },
    image: {
      markdown: "# Visual evidence\n\nOne short context line.",
      config: {
        type: "image",
        layout: "center",
        terminal: { enabled: false },
        mustReadUrl: "",
        image: {
          src: "",
          alt: "",
          x: 0,
          y: 0,
          scale: 1
        }
      }
    },
    terminalFocused: {
      markdown: "",
      config: {
        type: "terminalFocused",
        layout: "center",
        terminal: {
          enabled: true,
          leftVw: 7,
          topVh: 9,
          widthVw: 86,
          heightVh: 78,
          title: "Terminal"
        },
        mustReadUrl: ""
      }
    },
    dense: {
      markdown: "# Technical detail\n\n- Key fact\n- Constraint\n- Evidence",
      config: {
        type: "dense",
        layout: "center",
        terminal: { enabled: false },
        mustReadUrl: ""
      }
    }
  };

  function normalizeTypographyDefaults(defaults) {
    const value = defaults && typeof defaults === "object" ? { ...defaults } : {};
    const legacy = Number.isFinite(Number(value.textScale)) ? Number(value.textScale) : 1;
    const headingScale = Number.isFinite(Number(value.headingScale)) ? Number(value.headingScale) : legacy;
    const bodyScale = Number.isFinite(Number(value.bodyScale)) ? Number(value.bodyScale) : legacy;
    value.headingScale = clamp(headingScale, minTypographyScale, maxTypographyScale);
    value.bodyScale = clamp(bodyScale, minTypographyScale, maxTypographyScale);
    value.textScale = clamp(Number.isFinite(Number(value.textScale)) ? Number(value.textScale) : value.bodyScale, minTypographyScale, maxTypographyScale);
    return value;
  }

  function readTypographyScale(input, fallback) {
    const next = Number(input?.value);
    if (!Number.isFinite(next)) {
      return fallback;
    }
    return clamp(next, minTypographyScale, maxTypographyScale);
  }

  function slideTypographyScales(config, defaults) {
    const normalizedDefaults = normalizeTypographyDefaults(defaults || initialTypographyDefaults);
    const legacy = Number.isFinite(Number(config?.textScale)) ? Number(config.textScale) : null;
    const headingScale = Number.isFinite(Number(config?.headingScale))
      ? clamp(Number(config.headingScale), minTypographyScale, maxTypographyScale)
      : legacy ?? normalizedDefaults.headingScale;
    const bodyScale = Number.isFinite(Number(config?.bodyScale))
      ? clamp(Number(config.bodyScale), minTypographyScale, maxTypographyScale)
      : legacy ?? normalizedDefaults.bodyScale;
    return {
      headingScale,
      bodyScale
    };
  }

  function applySlideTypographyPreview(index) {
    const slide = slides[index];
    if (!slide) {
      return;
    }

    const config = draftConfig.slides[index] || {};
    const hasExplicitScale = Number.isFinite(Number(config.headingScale))
      || Number.isFinite(Number(config.bodyScale))
      || Number.isFinite(Number(config.textScale));

    if (!hasExplicitScale) {
      slide.style.removeProperty("--heading-scale");
      slide.style.removeProperty("--body-scale");
      return;
    }

    const scales = slideTypographyScales(config, draftConfig.defaults || initialTypographyDefaults);
    slide.style.setProperty("--heading-scale", String(scales.headingScale));
    slide.style.setProperty("--body-scale", String(scales.bodyScale));
    scheduleMermaidRender();
  }

  function mermaidColor(name, fallback) {
    const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  function mermaidThemeVariables() {
    const isLight = themeMode === "light";
    const bg = isLight ? "#f7f8fb" : "#0f1115";
    const fg = isLight ? "#111827" : "#edf2f7";
    const muted = isLight ? "#475569" : "#94a3b8";
    const accent = isLight ? "#0f766e" : "#7dff9b";
    const surface = isLight ? "rgba(255, 255, 255, 0.96)" : "rgba(255, 255, 255, 0.06)";
    const surfaceStrong = isLight ? "rgba(255, 255, 255, 1)" : "rgba(255, 255, 255, 0.1)";
    const surfaceBorder = isLight ? "rgba(15, 23, 42, 0.12)" : "rgba(242, 242, 242, 0.12)";

    return {
      background: bg,
      primaryColor: surfaceStrong,
      primaryTextColor: fg,
      primaryBorderColor: surfaceBorder,
      secondaryColor: surface,
      secondaryTextColor: fg,
      secondaryBorderColor: surfaceBorder,
      tertiaryColor: surface,
      tertiaryTextColor: fg,
      tertiaryBorderColor: surfaceBorder,
      lineColor: muted,
      textColor: fg,
      noteBkgColor: surface,
      noteTextColor: fg,
      clusterBkg: surface,
      clusterBorder: surfaceBorder,
      actorBkg: surfaceStrong,
      actorBorder: surfaceBorder,
      actorTextColor: fg,
      fontFamily: '"Inter", "Avenir Next", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
      fontSize: 18,
      pie1: accent,
      pie2: surfaceStrong,
      pie3: muted
    };
  }

  function mermaidTypographyScale(element) {
    const slide = element?.closest(".slide");
    const root = slide || document.documentElement;
    const value = Number(window.getComputedStyle(root).getPropertyValue("--body-scale").trim());
    if (!Number.isFinite(value)) {
      return 1;
    }
    return clamp(value, minTypographyScale, maxTypographyScale);
  }

  function scaledMermaidSize(value, scale, min, max) {
    return clamp(Math.round(value * scale), min, max);
  }

  function scaleMermaidSource(source, scale) {
    const normalizedScale = Number.isFinite(scale) ? scale : 1;
    if (normalizedScale === 1) {
      return source;
    }

    const scaleProperty = (input, property, unit = "px") => {
      const pattern = new RegExp(`(${property}\\s*:\\s*)(\\d+(?:\\.\\d+)?)(?:${unit})`, "gi");
      return input.replace(pattern, (_, prefix, value) => `${prefix}${Math.max(1, Math.round(Number(value) * normalizedScale))}${unit}`);
    };

    return scaleProperty(
      scaleProperty(
        scaleProperty(source, "font-size"),
        "stroke-width"
      ),
      "padding"
    );
  }

  function mermaidConfigFor(element, scale) {
    const nextScale = Number.isFinite(scale) ? scale : 1;
    const isLight = themeMode === "light";
    const baseFontSize = scaledMermaidSize(18, nextScale, 14, 30);
    const wrappingWidth = scaledMermaidSize(240, nextScale, 180, 420);
    const nodeSpacing = scaledMermaidSize(88, nextScale, 60, 140);
    const rankSpacing = scaledMermaidSize(108, nextScale, 72, 180);

    return {
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      fontFamily: '"Inter", "Avenir Next", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
      fontSize: baseFontSize,
      markdownAutoWrap: true,
      wrap: true,
      themeVariables: mermaidThemeVariables(),
      flowchart: {
        useMaxWidth: true,
        htmlLabels: true,
        curve: "basis",
        nodeSpacing,
        rankSpacing,
        wrappingWidth
      },
      sequence: {
        useMaxWidth: true
      },
      gantt: {
        useMaxWidth: true
      },
      journey: {
        useMaxWidth: true
      },
      mindmap: {
        useMaxWidth: true
      },
      themeCSS: `
        .node rect,
        .node circle,
        .node ellipse,
        .node polygon {
          rx: 16px;
          ry: 16px;
          stroke-width: ${scaledMermaidSize(2, nextScale, 1, 4)}px;
        }

        .node text,
        .edgeLabel text,
        .label text {
          font-family: "Inter", "Avenir Next", "Segoe UI", "Helvetica Neue", Arial, sans-serif;
          font-size: ${baseFontSize}px;
          font-weight: 600;
          letter-spacing: 0.01em;
          fill: ${isLight ? "#111827" : "#edf2f7"};
        }

        .node .label,
        .label,
        .edgeLabel {
          line-height: 1.18;
          white-space: normal;
          text-align: center;
        }

        .nodeLabel,
        foreignObject {
          overflow: visible;
        }

        .edgePath path,
        .flowchart-link {
          stroke-width: ${scaledMermaidSize(2.4, nextScale, 2, 5)}px;
        }

        .marker {
          fill: currentColor;
          stroke: currentColor;
        }

        svg {
          overflow: visible;
        }
      `
    };
  }

  function scheduleMermaidRender() {
    if (mermaidRenderFrame) {
      return;
    }

    mermaidRenderFrame = window.requestAnimationFrame(() => {
      mermaidRenderFrame = 0;
      renderMermaidDiagrams().catch((error) => {
        console.error(error);
      });
    });
  }

  async function loadMermaidRuntime() {
    if (!mermaidRuntimePromise) {
      mermaidRuntimePromise = import(mermaidModulePath)
        .then((module) => module.default || module)
        .catch((error) => {
          mermaidRuntimePromise = null;
          throw error;
        });
    }

    return mermaidRuntimePromise;
  }

  function mermaidDiagramSource(element) {
    if (!element) {
      return "";
    }

    const cached = mermaidSources.get(element);
    if (typeof cached === "string") {
      return cached;
    }

    const sourceNode = element.querySelector(".mermaid-source");
    const source = sourceNode ? sourceNode.textContent || "" : "";
    mermaidSources.set(element, source);
    return source;
  }

  async function renderMermaidDiagram(element, mermaid) {
    const source = mermaidDiagramSource(element).trim();
    if (!source) {
      element.classList.add("mermaid-empty");
      return;
    }

    const scale = mermaidTypographyScale(element);
    const renderId = `mermaid-${mermaidDiagramCounter += 1}`;
    const renderedSource = scaleMermaidSource(source, scale);
    mermaid.initialize(mermaidConfigFor(element, scale));
    const result = await mermaid.render(renderId, renderedSource);
    mermaidSources.set(element, source);
    element.innerHTML = result.svg;
    element.classList.add("mermaid-rendered");
    element.classList.remove("mermaid-failed", "mermaid-empty");
    if (typeof result.bindFunctions === "function") {
      result.bindFunctions(element);
    }
  }

  async function renderMermaidDiagrams() {
    const diagrams = Array.from(document.querySelectorAll(".mermaid-diagram"));
    if (!diagrams.length) {
      return;
    }

    const token = ++mermaidRenderToken;
    const mermaid = await loadMermaidRuntime();
    if (token !== mermaidRenderToken) {
      return;
    }

    for (const diagram of diagrams) {
      if (token !== mermaidRenderToken) {
        return;
      }

      try {
        await renderMermaidDiagram(diagram, mermaid);
      } catch (error) {
        diagram.classList.add("mermaid-failed");
        diagram.title = `Mermaid render failed: ${error.message}`;
        console.error(error);
      }
    }
  }

  function currentTypographyValues() {
    const defaults = normalizeTypographyDefaults(draftConfig.defaults || initialTypographyDefaults);
    return {
      headingScale: readTypographyScale(headingScaleInput, defaults.headingScale),
      bodyScale: readTypographyScale(bodyScaleInput, defaults.bodyScale)
    };
  }

  function applyTypographyFields(config, typography) {
    config.headingScale = typography.headingScale;
    config.bodyScale = typography.bodyScale;
    config.textScale = typography.bodyScale;
    return config;
  }

  function firstSlideHeading(markdown, fallback) {
    const lines = String(markdown ?? "").replace(/\r\n/g, "\n").split("\n");
    let inFence = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      if (trimmed.startsWith("```")) {
        inFence = !inFence;
        continue;
      }

      if (inFence) {
        continue;
      }

      const heading = trimmed.match(/^#{1,6}\s+(.+)$/);
      if (heading) {
        return heading[1].trim();
      }

      return trimmed;
    }

    return fallback;
  }

  function templateLabel(type) {
    switch (type) {
      case "cover":
        return "Cover";
      case "terminalText":
        return "Terminal + Minimal Text";
      case "text":
        return "Text-Only";
      case "image":
        return "Image-Focused";
      case "terminalFocused":
        return "Terminal-Focused";
      case "dense":
        return "Content-Dense";
      default:
        return type || "Text-Only";
    }
  }

  function slideDisplayHeading(index) {
    const markdown = draftContentSlides[index] || "";
    return index === 0
      ? (draftConfig.cover?.title || draftConfig.title || "Cover")
      : firstSlideHeading(markdown, `Slide ${index + 1}`);
  }

  function clearSlideOrderDropState() {
    slideOrderDropIndex = -1;
    slideOrderDropPosition = "";
    if (!slideOrderList) {
      return;
    }
    slideOrderList.querySelectorAll(".slide-order-item").forEach((item) => {
      item.classList.remove("drag-over-top", "drag-over-bottom");
    });
  }

  function markSlideOrderDropState(index, position) {
    if (!slideOrderList) {
      return;
    }

    if (slideOrderDropIndex === index && slideOrderDropPosition === position) {
      return;
    }

    clearSlideOrderDropState();
    slideOrderDropIndex = index;
    slideOrderDropPosition = position;

    const item = slideOrderList.querySelector(`.slide-order-item[data-index="${index}"]`);
    if (item) {
      item.classList.add(position === "after" ? "drag-over-bottom" : "drag-over-top");
    }
  }

  function slideOrderInsertionIndex(fromIndex, targetIndex, position) {
    if (position === "after") {
      return fromIndex <= targetIndex ? targetIndex : targetIndex + 1;
    }

    return fromIndex < targetIndex ? targetIndex - 1 : targetIndex;
  }

  function moveSlide(fromIndex, insertionIndex) {
    normalizeDraft();
    const maxIndex = draftContentSlides.length - 1;
    const from = clamp(fromIndex, 0, maxIndex);
    const to = clamp(insertionIndex, 0, maxIndex);

    if (from === 0 || to === 0 || from === to) {
      return false;
    }

    const [contentSlide] = draftContentSlides.splice(from, 1);
    const [slideConfig] = draftConfig.slides.splice(from, 1);
    draftContentSlides.splice(to, 0, contentSlide);
    draftConfig.slides.splice(to, 0, slideConfig);

    if (editorIndex === from) {
      editorIndex = to;
    } else {
      let nextEditorIndex = editorIndex;
      if (from < nextEditorIndex) {
        nextEditorIndex -= 1;
      }
      if (to <= nextEditorIndex) {
        nextEditorIndex += 1;
      }
      editorIndex = clamp(nextEditorIndex, 0, draftContentSlides.length - 1);
    }

    return true;
  }

  function normalizeMustReadUrl(url) {
    const value = String(url ?? "").trim();
    if (!value) {
      return "";
    }

    if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//")) {
      return value;
    }

    return `https://${value}`;
  }

  function clampImageScale(value) {
    return clamp(value, 0.2, 3);
  }

  function imageConfig(index) {
    const slide = draftConfig.slides[index];
    if (!slide || slide.type !== "image") {
      return null;
    }
    slide.image = slide.image && typeof slide.image === "object" ? slide.image : {};
    return slide.image;
  }

  function imageSlideElement(index) {
    return document.querySelector(`.slide[data-slide-index="${index}"]`);
  }

  function imageStageElement(index) {
    return document.getElementById(`image-stage-${index}`);
  }

  function imageFrameElement(index) {
    const stage = imageStageElement(index);
    return stage ? stage.querySelector(".image-frame") : null;
  }

  function imageElement(index) {
    const stage = imageStageElement(index);
    return stage ? stage.querySelector("img") : null;
  }

  function syncImageSource(index) {
    const config = imageConfig(index);
    const img = imageElement(index);
    if (!img) {
      return;
    }

    const nextSrc = config?.src ? String(config.src) : "";
    if (!nextSrc) {
      img.removeAttribute("src");
      return;
    }

    if (img.getAttribute("src") !== nextSrc) {
      img.src = nextSrc;
    }
  }

  function syncImageInputs(config) {
    if (!config) {
      return;
    }
    if (imageScale) {
      imageScale.value = String(Number(config.scale || 1));
    }
    if (imageAlt) {
      imageAlt.value = config.alt || "";
    }
    if (imageX) {
      imageX.value = String(Number(config.x || 0));
    }
    if (imageY) {
      imageY.value = String(Number(config.y || 0));
    }
  }

  function renderImageToDom(index) {
    const config = imageConfig(index);
    const frame = imageFrameElement(index);
    if (!config || !frame) {
      return;
    }

    syncImageSource(index);
    const x = Number.isFinite(Number(config.x)) ? Number(config.x) : 0;
    const y = Number.isFinite(Number(config.y)) ? Number(config.y) : 0;
    const scale = Number.isFinite(Number(config.scale)) ? Number(config.scale) : 1;
    frame.style.transform = `translate(${x}%, ${y}%) scale(${scale})`;
  }

  function applyImageToDom(index) {
    pendingImageRenders.add(index);
    if (imageRenderFrame) {
      return;
    }

    imageRenderFrame = window.requestAnimationFrame(() => {
      imageRenderFrame = 0;
      const indexes = Array.from(pendingImageRenders);
      pendingImageRenders.clear();
      indexes.forEach(renderImageToDom);
    });
  }

  function applyImageConfig(index, next) {
    const config = imageConfig(index);
    if (!config) {
      return;
    }

    if (typeof next.x === "number") {
      config.x = clamp(next.x, -100, 100);
    }
    if (typeof next.y === "number") {
      config.y = clamp(next.y, -100, 100);
    }
    if (typeof next.scale === "number") {
      config.scale = clampImageScale(next.scale);
    }
    if (typeof next.alt === "string") {
      config.alt = next.alt;
    }

    syncImageInputs(config);
    applyImageToDom(index);
  }

  function clearImageConfig(index) {
    const config = imageConfig(index);
    if (!config) {
      return;
    }

    config.src = "";
    config.alt = "";
    config.x = 0;
    config.y = 0;
    config.scale = 1;
    syncImageInputs(config);
    syncImageSource(index);
    applyImageToDom(index);
  }

  function finishImageEdit(event) {
    if (!imageDragState.active || (event && event.pointerId !== imageDragState.pointerId)) {
      return;
    }

    if (imageDragState.stage) {
      imageDragState.stage.classList.remove("dragging");
      try {
        if (imageDragState.stage.hasPointerCapture(imageDragState.pointerId)) {
          imageDragState.stage.releasePointerCapture(imageDragState.pointerId);
        }
      } catch {
        // Ignore pointer capture errors.
      }
    }
    imageDragState.active = false;
    imageDragState.pointerId = null;
    imageDragState.index = -1;
    imageDragState.stage = null;
    imageDragState.stageRect = null;
    saveEditorFields();
    setEditorStatus("Image adjusted.");
  }

  function beginImageEdit(event) {
    if (mode !== "edit" || event.button !== 0) {
      return;
    }

    const img = event.target.closest?.(".slide-type-image .image-stage img");
    if (!img) {
      return;
    }

    const slide = img.closest(".slide");
    const index = Number(slide?.dataset.slideIndex);
    if (!Number.isInteger(index) || index !== editorIndex) {
      return;
    }

    const config = imageConfig(index);
    const stage = img.closest(".image-stage");
    if (!config || !stage) {
      return;
    }

    event.preventDefault();
    imageDragState.active = true;
    imageDragState.pointerId = event.pointerId;
    imageDragState.index = index;
    imageDragState.mode = event.altKey ? "scale" : "move";
    imageDragState.startClientX = event.clientX;
    imageDragState.startClientY = event.clientY;
    imageDragState.startX = Number(config.x || 0);
    imageDragState.startY = Number(config.y || 0);
    imageDragState.startScale = Number(config.scale || 1);
    imageDragState.stageRect = stage.getBoundingClientRect();
    imageDragState.stage = stage;
    stage.classList.add("dragging");
    try {
      stage.setPointerCapture(event.pointerId);
    } catch {
      // Ignore capture failures.
    }
  }

  function moveImageEdit(event) {
    if (!imageDragState.active || event.pointerId !== imageDragState.pointerId) {
      return;
    }

    const index = imageDragState.index;
    const config = imageConfig(index);
    const stageRect = imageDragState.stageRect;
    if (!config || !stageRect) {
      return;
    }

    event.preventDefault();
    if (imageDragState.mode === "scale") {
      const deltaY = event.clientY - imageDragState.startClientY;
      const nextScale = clampImageScale(imageDragState.startScale * (1 - deltaY / 200));
      applyImageConfig(index, { scale: nextScale });
      return;
    }

    const deltaX = event.clientX - imageDragState.startClientX;
    const deltaY = event.clientY - imageDragState.startClientY;
    const nextX = imageDragState.startX + (deltaX / stageRect.width) * 100;
    const nextY = imageDragState.startY + (deltaY / stageRect.height) * 100;
    applyImageConfig(index, { x: nextX, y: nextY });
  }

  function wheelImageEdit(event) {
    if (mode !== "edit") {
      return;
    }

    const img = event.target.closest?.(".slide-type-image .image-stage img");
    if (!img) {
      return;
    }

    const slide = img.closest(".slide");
    const index = Number(slide?.dataset.slideIndex);
    if (!Number.isInteger(index) || index !== editorIndex) {
      return;
    }

    const config = imageConfig(index);
    if (!config) {
      return;
    }

    event.preventDefault();
    const factor = event.deltaY > 0 ? 0.96 : 1.04;
    applyImageConfig(index, { scale: clampImageScale((Number(config.scale) || 1) * factor) });
    setEditorStatus("Image resized.");
  }

  function applyTypographyScales(syncInputs = true) {
    draftConfig.defaults = normalizeTypographyDefaults(draftConfig.defaults || {});
    const defaults = draftConfig.defaults;
    document.documentElement.style.setProperty("--heading-scale", String(defaults.headingScale));
    document.documentElement.style.setProperty("--body-scale", String(defaults.bodyScale));
    if (syncInputs) {
      if (headingScaleInput) {
        headingScaleInput.value = String(defaults.headingScale);
      }
      if (bodyScaleInput) {
        bodyScaleInput.value = String(defaults.bodyScale);
      }
    }
    scheduleMermaidRender();
    return defaults;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function applyTemplateGeometry(config) {
    if (!config || typeof config !== "object") {
      return config;
    }

    if (config.type === "terminalText") {
      config.layout = "hero";
      config.terminal = {
        ...(config.terminal || {}),
        enabled: true,
        leftVw: 46,
        topVh: 10,
        widthVw: 48,
        heightVh: 83,
        position: (config.terminal && config.terminal.position === "left") ? "left" : "right"
      };
    } else if (config.type === "terminalFocused") {
      config.layout = "center";
      config.terminal = {
        ...(config.terminal || {}),
        enabled: true,
        leftVw: 7,
        topVh: 9,
        widthVw: 86,
        heightVh: 78
      };
    }

    return config;
  }

  function isEditableTarget(target) {
    return target && ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(target.tagName);
  }

  function terminalPosition(config) {
    return config?.type === "terminalText" && config.terminal?.position === "left" ? "left" : "right";
  }

  function updateTerminalSwapButton(config) {
    if (!terminalSwap || !terminalSwapField) {
      return;
    }

    const isTerminalText = config?.type === "terminalText";
    terminalSwapField.style.display = isTerminalText ? "" : "none";
    if (!isTerminalText) {
      return;
    }

    const position = terminalPosition(config);
    terminalSwap.textContent = position === "left" ? "Text left" : "Terminal left";
    terminalSwap.setAttribute("aria-label", position === "left" ? "Swap back to text on the left" : "Swap terminal to the left");
  }

  function updateThemeToggle() {
    if (!themeToggle) {
      return;
    }

    const nextTheme = themeMode === "dark" ? "light" : "dark";
    setThemedIcon(themeToggle.querySelector(".control-icon"));
    themeToggle.setAttribute("aria-label", `Switch to ${nextTheme} mode`);
    themeToggle.setAttribute("title", `Switch to ${nextTheme} mode`);
    themeToggle.setAttribute("aria-pressed", themeMode === "light" ? "true" : "false");
  }

  function setThemedIcon(icon, state = "icon") {
    if (!icon) {
      return;
    }

    const themeKey = themeMode === "light" ? "light" : "dark";
    const stateSource = icon.dataset[`${state}${themeKey[0].toUpperCase()}${themeKey.slice(1)}`];
    const defaultSource = icon.dataset[`icon${themeKey[0].toUpperCase()}${themeKey.slice(1)}`];
    icon.src = stateSource || defaultSource || icon.src;
  }

  function updateThemedIcons() {
    document.querySelectorAll(".control-icon").forEach((icon) => {
      setThemedIcon(icon);
    });
    updateAudioControls(Boolean(audioElement && !audioElement.paused));
    updateCameraQuickToggle();
  }

  function applyTheme(nextTheme, persist = true) {
    themeMode = nextTheme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = themeMode;

    if (persist) {
      try {
        window.localStorage.setItem("presentation-theme", themeMode);
      } catch {
        // Ignore storage failures.
      }
    }

    updateThemeToggle();
    updateThemedIcons();
    scheduleMermaidRender();
  }

  async function copyTextToClipboard(text) {
    const value = String(text ?? "");
    if (!value) {
      return false;
    }

    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }

    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.append(textarea);
    textarea.select();
    try {
      return document.execCommand("copy");
    } finally {
      textarea.remove();
    }
  }

  function markCopyButton(button, copied) {
    if (!button) {
      return;
    }

    const originalText = button.dataset.originalText || button.textContent || "Copy";
    button.dataset.originalText = originalText;
    button.textContent = copied ? "Copied" : "Copy failed";
    button.classList.toggle("copied", copied);
    window.setTimeout(() => {
      button.textContent = originalText;
      button.classList.remove("copied");
    }, 1200);
  }

  function handleMarkdownCopy(event) {
    const button = event.target?.closest?.(".markdown-copy-button");
    if (!button) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    copyTextToClipboard(button.dataset.copyText || "")
      .then((copied) => {
        markCopyButton(button, copied);
      })
      .catch(() => {
        markCopyButton(button, false);
      });
  }

  function setCameraStatus(text) {
    if (cameraStatus) {
      cameraStatus.textContent = text || "";
    }
  }

  function cameraSettings() {
    const rawSize = Number(cameraSize?.value);
    const rawZoom = Number(cameraZoom?.value);
    return {
      deviceId: cameraSource?.value || "",
      audio: !!cameraMicrophone?.checked,
      position: cameraPosition?.value || "top-right",
      size: Number.isFinite(rawSize) ? clamp(rawSize, 0, 100) : 20,
      zoom: Number.isFinite(rawZoom) ? clamp(rawZoom, 1, 2.5) : 1
    };
  }

  function persistCameraSettings() {
    try {
      window.localStorage.setItem(cameraSettingsStorageKey, JSON.stringify(cameraSettings()));
    } catch {
      // Ignore storage failures.
    }
  }

  function loadCameraSettings() {
    let settings = null;
    try {
      settings = JSON.parse(window.localStorage.getItem(cameraSettingsStorageKey) || "null");
    } catch {
      settings = null;
    }

    if (!settings || typeof settings !== "object") {
      return;
    }

    if (cameraMicrophone) {
      cameraMicrophone.checked = settings.audio === true;
    }
    if (cameraPosition && ["top-right", "top-left", "bottom-right", "bottom-left"].includes(settings.position)) {
      cameraPosition.value = settings.position;
    }
    if (cameraSize) {
      let size = Number(settings.size);
      if (!Number.isFinite(size)) {
        size = settings.size === "small" ? 10 : settings.size === "large" ? 30 : 20;
      }
      cameraSize.value = String(clamp(size, 0, 100));
    }
    if (cameraZoom) {
      const zoom = Number(settings.zoom);
      cameraZoom.value = String(Number.isFinite(zoom) ? clamp(zoom, 1, 2.5) : 1);
    }
    if (cameraSource && typeof settings.deviceId === "string") {
      cameraSource.dataset.preferredDeviceId = settings.deviceId;
    }
  }

  function applyCameraOverlaySettings() {
    if (!cameraOverlay) {
      return;
    }

    const settings = cameraSettings();
    cameraOverlay.classList.remove(
      "position-top-right",
      "position-top-left",
      "position-bottom-right",
      "position-bottom-left"
    );
    cameraOverlay.style.setProperty("--camera-size", String(settings.size));
    cameraOverlay.style.setProperty("--camera-zoom", String(settings.zoom));
    cameraOverlay.classList.add(`position-${settings.position}`);
  }

  function updateCameraVisibility() {
    if (!cameraOverlay) {
      return;
    }

    applyCameraOverlaySettings();
    const visible = cameraEnabled && !!cameraStream;
    cameraOverlay.classList.toggle("active", visible);
    cameraOverlay.setAttribute("aria-hidden", visible ? "false" : "true");
    updateCameraQuickToggle();
  }

  function updateCameraQuickToggle() {
    if (cameraQuickToggle) {
      setThemedIcon(cameraQuickToggle.querySelector(".control-icon"), cameraEnabled ? "on" : "off");
      cameraQuickToggle.title = cameraEnabled ? "Camera off" : "Camera on";
      cameraQuickToggle.setAttribute("aria-label", cameraEnabled ? "Camera off" : "Camera on");
      cameraQuickToggle.setAttribute("aria-pressed", cameraEnabled ? "true" : "false");
    }
  }

  function stopCameraStream() {
    stopAudioDucking();
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
    }
    cameraStream = null;
    cameraEnabled = false;
    if (cameraVideo) {
      cameraVideo.srcObject = null;
    }
    updateCameraVisibility();
  }

  async function loadCameraDevices(selectedDeviceId = "") {
    if (!cameraSource || !navigator.mediaDevices?.enumerateDevices) {
      return;
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoInputs = devices.filter((device) => device.kind === "videoinput");
    const fragment = document.createDocumentFragment();
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "Default camera";
    fragment.append(defaultOption);

    videoInputs.forEach((device, index) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.label || `Camera ${index + 1}`;
      fragment.append(option);
    });

    cameraSource.replaceChildren(fragment);
    const preferredDeviceId = selectedDeviceId || cameraSource.dataset.preferredDeviceId || "";
    if (preferredDeviceId && videoInputs.some((device) => device.deviceId === preferredDeviceId)) {
      cameraSource.value = preferredDeviceId;
      delete cameraSource.dataset.preferredDeviceId;
    }
    cameraDevicesLoaded = true;
  }

  async function enableCameraStream() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStatus("Camera is not supported in this browser.");
      return;
    }

    const settings = cameraSettings();
    const video = settings.deviceId
      ? { deviceId: { exact: settings.deviceId } }
      : true;

    setCameraStatus("Requesting camera permission...");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video,
        audio: settings.audio
      });
      stopCameraStream();
      cameraStream = stream;
      cameraEnabled = true;
      if (cameraVideo) {
        cameraVideo.srcObject = stream;
        cameraVideo.muted = true;
      }
      await loadCameraDevices(settings.deviceId);
      persistCameraSettings();
      updateCameraVisibility();
      startAudioDucking();
      setCameraStatus("Camera enabled. Switch to Presentation Mode to keep it over the deck.");
    } catch (error) {
      setCameraStatus(`Camera failed: ${error.message}`);
    }
  }

  function desiredAudioVolume() {
    const raw = Number(audioVolume?.value);
    return (Number.isFinite(raw) ? clamp(raw, 0, 100) : 25) / 100;
  }

  function ensureAudioElement() {
    if (!audioElement) {
      audioElement = new Audio();
      audioElement.preload = "auto";
      audioElement.volume = desiredAudioVolume();
      audioElement.addEventListener("ended", () => {
        playAudioTrack(audioIndex + 1).catch((error) => {
          setEditorStatus(`Audio failed: ${error.message}`);
        });
      });
    }
    return audioElement;
  }

  async function loadAudioTracks() {
    if (audioLoaded) {
      return audioTracks;
    }

    audioLoaded = true;
    try {
      const response = await fetch("/api/audio");
      const payload = await response.json();
      audioTracks = Array.isArray(payload.tracks) ? payload.tracks : [];
      if (!audioTracks.length && audioPlay) {
        audioPlay.title = "No audio files found in content/audio";
      }
    } catch (error) {
      audioLoaded = false;
      throw error;
    }
    return audioTracks;
  }

  function updateAudioControls(playing = false) {
    if (audioPlay) {
      setThemedIcon(audioPlay.querySelector(".control-icon"), playing ? "stop" : "play");
      audioPlay.title = playing ? "Stop background audio" : "Play background audio";
      audioPlay.setAttribute("aria-label", playing ? "Stop background audio" : "Play background audio");
    }
  }

  async function playAudioTrack(index = audioIndex) {
    await loadAudioTracks();
    if (!audioTracks.length) {
      updateAudioControls(false);
      return;
    }

    audioIndex = (index + audioTracks.length) % audioTracks.length;
    const track = audioTracks[audioIndex];
    const player = ensureAudioElement();
    if (player.getAttribute("src") !== track.url) {
      player.src = track.url;
    }
    player.volume = desiredAudioVolume();
    await player.play();
    updateAudioControls(true);
  }

  function stopAudio() {
    if (audioElement) {
      audioElement.pause();
      audioElement.currentTime = 0;
    }
    updateAudioControls(false);
  }

  function stopAudioDucking() {
    if (audioDuckingFrame) {
      window.cancelAnimationFrame(audioDuckingFrame);
      audioDuckingFrame = 0;
    }
    if (audioDuckingContext) {
      try {
        audioDuckingContext.context.close();
      } catch {
        // Ignore close failures.
      }
    }
    audioDuckingContext = null;
    if (audioElement) {
      audioElement.volume = desiredAudioVolume();
    }
  }

  function startAudioDucking() {
    stopAudioDucking();
    const microphoneTracks = cameraStream?.getAudioTracks?.() || [];
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!microphoneTracks.length || !AudioContextConstructor) {
      return;
    }

    try {
      const context = new AudioContextConstructor();
      const source = context.createMediaStreamSource(new MediaStream(microphoneTracks));
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      audioDuckingContext = {
        context,
        analyser,
        data: new Uint8Array(analyser.fftSize)
      };
    } catch {
      audioDuckingContext = null;
      return;
    }

    const tick = () => {
      if (!audioDuckingContext) {
        return;
      }

      audioDuckingContext.analyser.getByteTimeDomainData(audioDuckingContext.data);
      let sum = 0;
      audioDuckingContext.data.forEach((value) => {
        const centered = value - 128;
        sum += centered * centered;
      });
      const rms = Math.sqrt(sum / audioDuckingContext.data.length) / 128;
      if (audioElement && !audioElement.paused) {
        const base = desiredAudioVolume();
        audioElement.volume = rms > 0.045 ? base * 0.28 : base;
      }
      audioDuckingFrame = window.requestAnimationFrame(tick);
    };

    tick();
  }

  function updateCounter() {
    if (counter) {
      counter.textContent = `${currentIndex + 1} / ${slides.length}`;
    }
  }

  function createProgressDots() {
    if (!slideProgress) {
      return;
    }

    const fragment = document.createDocumentFragment();
    progressDots = [];
    slides.forEach((_, index) => {
      const dot = document.createElement("button");
      dot.className = "progress-dot";
      dot.type = "button";
      dot.title = `Slide ${index + 1}`;
      dot.setAttribute("aria-label", `Go to slide ${index + 1}`);
      dot.addEventListener("click", () => {
        setActiveSlide(index);
      });
      progressDots.push(dot);
      fragment.append(dot);
    });
    slideProgress.replaceChildren(fragment);
  }

  function updateProgressDots() {
    if (!slideProgress) {
      return;
    }

    slideProgress.classList.remove("forward", "backward");
    slideProgress.classList.add(navigationDirection);

    progressDots.forEach((dot, index) => {
      const state = index < currentIndex ? "completed" : index === currentIndex ? "current" : "upcoming";
      dot.className = `progress-dot ${state}`;
      dot.setAttribute("aria-current", index === currentIndex ? "step" : "false");
    });

    progressDots[currentIndex]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center"
    });
  }

  function terminalFocused() {
    for (const state of terminalStates.values()) {
      if (state.card && state.card.contains(document.activeElement)) {
        return true;
      }
    }
    return false;
  }

  function blurTerminalFocus() {
    const active = document.activeElement;
    if (active && typeof active.blur === "function" && active !== document.body && active !== document.documentElement) {
      active.blur();
    }
  }

  function slideConfig(index) {
    return presentation.slides?.[index] || {};
  }

  function terminalConfig(index) {
    const slide = slideConfig(index);
    return slide.terminal && slide.terminal.enabled ? slide.terminal : null;
  }

  function applyTerminalTabIndex(index, active) {
    const card = document.getElementById(`terminal-card-${index}`);
    if (card) {
      card.tabIndex = active ? 0 : -1;
      card.setAttribute("aria-hidden", active ? "false" : "true");
    }
  }

  function setStatus(index, text) {
    const status = document.getElementById(`terminal-status-${index}`);
    if (status) {
      status.textContent = text;
    }
  }

  function terminalCanFit(state) {
    return state.stage
      && state.stage.isConnected
      && state.stage.clientWidth > 0
      && state.stage.clientHeight > 0;
  }

  function fitTerminal(index, forceResize = false) {
    const state = terminalStates.get(index);
    if (!state || !state.term || !state.fitAddon) {
      return;
    }

    if (!terminalCanFit(state)) {
      return;
    }

    try {
      state.fitAddon.fit();
      if (state.socket && state.socket.readyState === WebSocket.OPEN) {
        const cols = state.term.cols;
        const rows = state.term.rows;
        if (forceResize || cols !== state.lastCols || rows !== state.lastRows) {
          state.socket.send(JSON.stringify({ type: "resize", cols, rows }));
          state.lastCols = cols;
          state.lastRows = rows;
        }
      }
    } catch (error) {
      console.error(error);
    }
  }

  function scheduleFitAllTerminals() {
    if (terminalFitFrame) {
      return;
    }

    terminalFitFrame = window.requestAnimationFrame(() => {
      terminalFitFrame = 0;
      terminalStates.forEach((_, index) => fitTerminal(index));
    });
  }

  function terminalWebSocketUrl(index) {
    const wsScheme = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${wsScheme}//${window.location.host}/terminal?slide=${index}`;
  }

  function socketIsOpen(socket) {
    return socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING);
  }

  function scheduleTerminalReconnect(index, state) {
    if (state.disposed || state.reconnectTimer || state.stopped) {
      return;
    }

    const delay = Math.min(reconnectMaxMs, reconnectBaseMs * (2 ** state.reconnectAttempt));
    state.reconnectAttempt = Math.min(state.reconnectAttempt + 1, 8);
    setStatus(index, `Reconnecting in ${Math.ceil(delay / 1000)}s`);
    state.reconnectTimer = window.setTimeout(() => {
      state.reconnectTimer = 0;
      openTerminalSocket(index, state);
    }, delay + Math.floor(Math.random() * 150));
  }

  function openTerminalSocket(index, state) {
    if (state.disposed || socketIsOpen(state.socket)) {
      return;
    }

    state.stopped = false;
    setStatus(index, state.reconnectAttempt > 0 ? "Reconnecting..." : "Connecting");

    let socket;
    try {
      socket = new WebSocket(terminalWebSocketUrl(index));
    } catch {
      scheduleTerminalReconnect(index, state);
      return;
    }

    state.socket = socket;

    socket.addEventListener("open", () => {
      if (state.socket !== socket || state.disposed) {
        socket.close();
        return;
      }

      state.reconnectAttempt = 0;
      setStatus(index, "Ready");
      fitTerminal(index, true);
    });

    socket.addEventListener("message", (event) => {
      if (state.socket !== socket || state.disposed) {
        return;
      }

      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        message = { type: "data", data: event.data };
      }

      if (message.type === "data") {
        state.term.write(message.data);
      } else if (message.type === "status" && typeof message.text === "string") {
        setStatus(index, message.text);
      } else if (message.type === "ready") {
        setStatus(index, "Ready");
        fitTerminal(index, true);
      }
    });

    socket.addEventListener("close", (event) => {
      if (state.socket === socket) {
        state.socket = null;
      }

      if (state.disposed) {
        return;
      }

      if (event.code === 1000 || event.code === 1008) {
        state.stopped = true;
        setStatus(index, event.reason || "Disconnected");
        return;
      }

      setStatus(index, "Disconnected");
      scheduleTerminalReconnect(index, state);
    });

    socket.addEventListener("error", () => {
      if (state.socket === socket && !state.disposed) {
        setStatus(index, "Connection error");
      }
    });
  }

  function disposeTerminalState(state) {
    state.disposed = true;
    if (state.reconnectTimer) {
      window.clearTimeout(state.reconnectTimer);
      state.reconnectTimer = 0;
    }
    try {
      if (state.socket && socketIsOpen(state.socket)) {
        state.socket.close();
      }
      if (state.resizeObserver) {
        state.resizeObserver.disconnect();
      }
      if (state.term) {
        state.term.dispose();
      }
    } catch (error) {
      console.error(error);
    }
  }

  function connectTerminal(index) {
    if (terminalStates.has(index)) {
      const existingState = terminalStates.get(index);
      applyTerminalTabIndex(index, true);
      if (!socketIsOpen(existingState.socket) && !existingState.reconnectTimer) {
        openTerminalSocket(index, existingState);
      }
      fitTerminal(index);
      return existingState;
    }

    const config = terminalConfig(index);
    if (!config) {
      return null;
    }

    const card = document.getElementById(`terminal-card-${index}`);
    const stage = document.getElementById(`terminal-stage-${index}`);
    if (!card || !stage || !window.Terminal || !window.FitAddon) {
      return null;
    }

    const defaults = presentation.defaults?.terminal || {};
    const fontSize = Number(config.fontSize || defaults.fontSize || 14);
    const term = new window.Terminal({
      cursorBlink: true,
      fontSize,
      fontFamily: '"SFMono-Regular", "Cascadia Mono", "IBM Plex Mono", "Menlo", "Consolas", monospace',
      lineHeight: 1.1,
      theme: {
        background: config.theme?.background || defaults.theme?.background || "#000000",
        foreground: config.theme?.foreground || defaults.theme?.foreground || "#f2f2f2",
        cursor: config.theme?.cursor || defaults.theme?.cursor || "#7dff9b",
        selectionBackground: config.theme?.selectionBackground || defaults.theme?.selectionBackground || "rgba(125, 255, 155, 0.24)"
      }
    });

    const fitAddon = new window.FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(stage);

    const state = {
      card,
      stage,
      status: document.getElementById(`terminal-status-${index}`),
      term,
      fitAddon,
      socket: null,
      reconnectAttempt: 0,
      reconnectTimer: 0,
      resizeObserver: null,
      lastCols: 0,
      lastRows: 0,
      disposed: false,
      stopped: false
    };

    terminalStates.set(index, state);

    if (window.ResizeObserver) {
      state.resizeObserver = new window.ResizeObserver(() => {
        scheduleFitAllTerminals();
      });
      state.resizeObserver.observe(card);
      state.resizeObserver.observe(stage);
    }

    card.addEventListener("click", () => {
      term.focus();
    });

    card.addEventListener("focusin", () => {
      card.classList.add("focused");
    });

    card.addEventListener("focusout", () => {
      window.setTimeout(() => {
        if (!card.contains(document.activeElement)) {
          card.classList.remove("focused");
        }
      }, 0);
    });

    term.onData((data) => {
      if (state.socket && state.socket.readyState === WebSocket.OPEN) {
        state.socket.send(JSON.stringify({ type: "input", data }));
      }
    });

    openTerminalSocket(index, state);
    fitTerminal(index, true);
    return state;
  }

  function updateSlideState(index, active) {
    const slide = slides[index];
    if (!slide) {
      return;
    }

    slide.classList.toggle("active", active);
    slide.setAttribute("aria-hidden", active ? "false" : "true");

    const config = slideConfig(index);
    const layout = config.layout === "hero" ? "hero" : "center";
    slide.classList.toggle("layout-hero", layout === "hero");
    slide.classList.toggle("layout-center", layout !== "hero" && config.type !== "cover");
    slide.classList.toggle("terminal-active", active && !!terminalConfig(index));
    applyTerminalTabIndex(index, active && !!terminalConfig(index));
    if (active && config.type === "image") {
      syncImageSource(index);
    } else if (!active && config.type === "image") {
      const img = imageElement(index);
      if (img) {
        img.removeAttribute("src");
      }
    }
  }

  function setActiveSlide(nextIndex) {
    const previousIndex = currentIndex;
    currentIndex = (nextIndex + slides.length) % slides.length;
    if (currentIndex !== previousIndex) {
      navigationDirection = nextIndex > previousIndex ? "forward" : "backward";
    }

    if (!activeSlideRendered) {
      slides.forEach((_, index) => {
        updateSlideState(index, index === currentIndex);
      });
      activeSlideRendered = true;
    } else if (currentIndex !== previousIndex) {
      updateSlideState(previousIndex, false);
      updateSlideState(currentIndex, true);
    }

    blurTerminalFocus();
    updateCounter();
    updateProgressDots();
    history.replaceState(null, "", `#${currentIndex + 1}`);
    editorIndex = currentIndex;
    loadEditor();

    if (terminalConfig(currentIndex)) {
      connectTerminal(currentIndex);
    }
  }

  function move(delta) {
    setActiveSlide(currentIndex + delta);
  }

  function queueMove(delta) {
    pendingNavigationDelta += delta;
    if (navigationFrame) {
      return;
    }

    navigationFrame = window.requestAnimationFrame(() => {
      const step = Math.sign(pendingNavigationDelta);
      pendingNavigationDelta = 0;
      navigationFrame = 0;
      if (step !== 0) {
        move(step);
      }
    });
  }

  function handleTypographyScaleShortcut(event) {
    const key = event.key;
    if (!event.ctrlKey && !event.metaKey) {
      return false;
    }

    if (key === "+" || key === "=") {
      event.preventDefault();
      const config = draftConfig.slides[editorIndex] || {};
      const defaults = normalizeTypographyDefaults(draftConfig.defaults || initialTypographyDefaults);
      const typography = slideTypographyScales(config, defaults);
      const target = event.shiftKey ? "headingScale" : "bodyScale";
      typography[target] = clamp(typography[target] + typographyScaleStep, minTypographyScale, maxTypographyScale);
      config.headingScale = typography.headingScale;
      config.bodyScale = typography.bodyScale;
      config.textScale = config.bodyScale;
      draftConfig.slides[editorIndex] = config;
      if (headingScaleInput) {
        headingScaleInput.value = String(typography.headingScale);
      }
      if (bodyScaleInput) {
        bodyScaleInput.value = String(typography.bodyScale);
      }
      applyTypographyScales(false);
      applySlideTypographyPreview(editorIndex);
      scheduleSaveEditorFields();
      scheduleFitAllTerminals();
      return true;
    }

    if (key === "-" || key === "_") {
      event.preventDefault();
      const config = draftConfig.slides[editorIndex] || {};
      const defaults = normalizeTypographyDefaults(draftConfig.defaults || initialTypographyDefaults);
      const typography = slideTypographyScales(config, defaults);
      const target = event.shiftKey ? "headingScale" : "bodyScale";
      typography[target] = clamp(typography[target] - typographyScaleStep, minTypographyScale, maxTypographyScale);
      config.headingScale = typography.headingScale;
      config.bodyScale = typography.bodyScale;
      config.textScale = config.bodyScale;
      draftConfig.slides[editorIndex] = config;
      if (headingScaleInput) {
        headingScaleInput.value = String(typography.headingScale);
      }
      if (bodyScaleInput) {
        bodyScaleInput.value = String(typography.bodyScale);
      }
      applyTypographyScales(false);
      applySlideTypographyPreview(editorIndex);
      scheduleSaveEditorFields();
      scheduleFitAllTerminals();
      return true;
    }

    if (key === "0") {
      event.preventDefault();
      const config = draftConfig.slides[editorIndex] || {};
      delete config.headingScale;
      delete config.bodyScale;
      delete config.textScale;
      draftConfig.slides[editorIndex] = config;
      const defaults = normalizeTypographyDefaults(draftConfig.defaults || initialTypographyDefaults);
      if (headingScaleInput) {
        headingScaleInput.value = String(defaults.headingScale);
      }
      if (bodyScaleInput) {
        bodyScaleInput.value = String(defaults.bodyScale);
      }
      applyTypographyScales(false);
      applySlideTypographyPreview(editorIndex);
      scheduleSaveEditorFields();
      scheduleFitAllTerminals();
      return true;
    }

    return false;
  }

  function applyMode(nextMode, persist = true) {
    mode = nextMode === "edit" ? "edit" : "present";
    document.documentElement.dataset.mode = mode;
    if (mode !== "edit" && cameraPanel && cameraToggle) {
      cameraPanel.classList.remove("open");
      cameraToggle.setAttribute("aria-expanded", "false");
    }
    if (modeToggle) {
      setThemedIcon(modeToggle.querySelector(".control-icon"));
      modeToggle.title = mode === "present" ? "Switch to edit mode" : "Switch to presentation mode";
      modeToggle.setAttribute("aria-pressed", mode === "edit" ? "true" : "false");
      modeToggle.setAttribute("aria-label", mode === "present" ? "Switch to edit mode" : "Switch to presentation mode");
    }
    if (persist) {
      try {
        window.localStorage.setItem("presentation-mode", mode);
      } catch {
        // Ignore storage failures.
      }
    }
    scheduleFitAllTerminals();
    updateCameraVisibility();
  }

  function setEditorStatus(text) {
    if (editorStatus) {
      editorStatus.textContent = text || "";
    }
  }

  function normalizeDraft() {
    if (!draftContentSlides.length) {
      draftContentSlides = [""];
    }
    draftContentSlides = draftContentSlides.slice(0, constraints.maxSlides || 100);
    draftConfig.slides = Array.isArray(draftConfig.slides) ? draftConfig.slides : [];
    while (draftConfig.slides.length < draftContentSlides.length) {
      draftConfig.slides.push(clone(templateDefaults.text.config));
    }
    draftConfig.slides = draftConfig.slides.slice(0, draftContentSlides.length);
    draftConfig.slides = draftConfig.slides.map((slideConfig) => applyTemplateGeometry(slideConfig));
    draftContentSlides = draftContentSlides.map((slide, index) => {
      return draftConfig.slides[index]?.type === "terminalFocused" ? "" : slide;
    });
    draftConfig.slides[0] = {
      ...(draftConfig.slides[0] || {}),
      type: "cover",
      layout: "cover",
      terminal: { enabled: false }
    };
  }

  function populateSlideSelect() {
    if (!slideSelect) {
      return;
    }
    normalizeDraft();
    const fragment = document.createDocumentFragment();
    draftContentSlides.forEach((markdown, index) => {
      const option = document.createElement("option");
      const type = draftConfig.slides[index]?.type || "text";
      option.value = String(index);
      const heading = index === 0
        ? (draftConfig.cover?.title || draftConfig.title || "Cover")
        : firstSlideHeading(markdown, `Slide ${index + 1}`);
      option.textContent = `${index + 1}. ${heading} (${templateLabel(type)})`;
      fragment.append(option);
    });
    slideSelect.replaceChildren(fragment);
    slideSelect.value = String(clamp(editorIndex, 0, draftContentSlides.length - 1));
  }

  function populateSlideOrderList() {
    if (!slideOrderList) {
      return;
    }

    normalizeDraft();
    clearSlideOrderDropState();
    const fragment = document.createDocumentFragment();

    draftContentSlides.forEach((markdown, index) => {
      const item = document.createElement("div");
      const handle = document.createElement("button");
      const meta = document.createElement("div");
      const title = document.createElement("div");
      const subtitle = document.createElement("div");
      const type = draftConfig.slides[index]?.type || "text";
      const isFixed = index === 0;

      item.className = "slide-order-item";
      item.dataset.index = String(index);
      item.tabIndex = 0;
      if (index === editorIndex) {
        item.classList.add("current");
      }
      if (isFixed) {
        item.classList.add("fixed");
      }

      handle.type = "button";
      handle.className = "slide-order-handle";
      handle.textContent = "⠿";
      handle.title = isFixed ? "Slide 1 is fixed" : "Drag to reorder";
      handle.setAttribute("aria-label", isFixed ? "Slide 1 is fixed" : `Drag slide ${index + 1} to reorder`);
      handle.disabled = isFixed;
      handle.draggable = !isFixed;
      handle.dataset.index = String(index);

      title.className = "slide-order-title";
      title.textContent = `${index + 1}. ${slideDisplayHeading(index)}`;
      subtitle.className = "slide-order-subtitle";
      subtitle.textContent = `${templateLabel(type)}${isFixed ? " · fixed cover" : ""}`;
      meta.className = "slide-order-meta";
      meta.append(title, subtitle);

      handle.addEventListener("dragstart", (event) => {
        if (isFixed) {
          event.preventDefault();
          return;
        }
        slideOrderDragIndex = index;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(index));
        window.requestAnimationFrame(() => {
          item.classList.add("current");
        });
      });

      handle.addEventListener("dragend", () => {
        slideOrderDragIndex = -1;
        clearSlideOrderDropState();
      });

      item.addEventListener("click", (event) => {
        if (event.target === handle) {
          return;
        }
        selectEditorIndex(index);
      });

      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectEditorIndex(index);
        }
      });

      item.append(handle, meta);
      fragment.append(item);
    });

    slideOrderList.replaceChildren(fragment);
  }

  function slideOrderTargetFromEvent(event) {
    const item = event.target?.closest?.(".slide-order-item");
    if (!item) {
      return null;
    }

    const index = Number.parseInt(item.dataset.index, 10);
    if (!Number.isInteger(index)) {
      return null;
    }

    return { item, index };
  }

  function reorderActiveSlide(fromIndex, targetIndex, position) {
    saveEditorFields();
    const insertionIndex = slideOrderInsertionIndex(fromIndex, targetIndex, position);
    const changed = moveSlide(fromIndex, insertionIndex);
    if (!changed) {
      clearSlideOrderDropState();
      return;
    }

    slideOrderDirty = true;
    loadEditor();
    setEditorStatus("Slide order updated. Save to persist.");
    scheduleFitAllTerminals();
  }

  function setFieldsVisible(fields, visible) {
    fields.forEach((element) => {
      element.style.display = visible ? "" : "none";
    });
  }

  function loadEditor() {
    if (!slideSelect) {
      return;
    }
    normalizeDraft();
    editorIndex = clamp(editorIndex, 0, draftContentSlides.length - 1);
    populateSlideSelect();
    populateSlideOrderList();

    const config = draftConfig.slides[editorIndex] || {};
    const type = config.type || "text";
    const isCover = editorIndex === 0 || type === "cover";
    const isImage = type === "image";
    const isTerminalFocused = type === "terminalFocused";
    const typography = slideTypographyScales(config, draftConfig.defaults || initialTypographyDefaults);

    if (templateSelect) {
      templateSelect.value = isCover ? "text" : type;
      templateSelect.disabled = isCover;
    }
    if (slideMarkdown) {
      slideMarkdown.value = draftContentSlides[editorIndex] || "";
    }
    if (coverTitle) {
      coverTitle.value = draftConfig.cover?.title || draftConfig.title || "";
    }
    if (coverSubtitle) {
      coverSubtitle.value = draftConfig.cover?.subtitle || draftConfig.cover?.kicker || "";
    }
    if (presenterName) {
      presenterName.value = draftConfig.presenter?.name || "";
    }
    if (presenterRole) {
      presenterRole.value = draftConfig.presenter?.role || "";
    }
    if (presenterContact) {
      presenterContact.value = draftConfig.presenter?.contact || "";
    }
    if (presenterWebsite) {
      presenterWebsite.value = draftConfig.presenter?.website || "";
    }
    if (presenterGithub) {
      presenterGithub.value = draftConfig.presenter?.github || "";
    }
    if (presenterLinkedin) {
      presenterLinkedin.value = draftConfig.presenter?.linkedin || "";
    }
    if (metadataDate) {
      metadataDate.value = draftConfig.metadata?.date || "";
    }
    if (metadataVersion) {
      metadataVersion.value = draftConfig.metadata?.version || "";
    }
    if (agendaInput) {
      agendaInput.value = Array.isArray(draftConfig.cover?.agenda) ? draftConfig.cover.agenda.join("\n") : "";
    }
    if (imageScale) {
      imageScale.value = String(config.image?.scale || 1);
    }
    if (imageAlt) {
      imageAlt.value = config.image?.alt || "";
    }
    if (imageX) {
      imageX.value = String(config.image?.x || 0);
    }
    if (imageY) {
      imageY.value = String(config.image?.y || 0);
    }
    if (mustReadUrl) {
      mustReadUrl.value = config.mustReadUrl || "";
    }
    if (headingScaleInput) {
      headingScaleInput.value = String(typography.headingScale);
    }
    if (bodyScaleInput) {
      bodyScaleInput.value = String(typography.bodyScale);
    }
    applyTypographyScales(false);
    if (!slideOrderDirty) {
      applySlideTypographyPreview(editorIndex);
      applyImageToDom(editorIndex);
    }
    updateTerminalSwapButton(config);
    if (deleteSlide) {
      deleteSlide.disabled = isCover || draftContentSlides.length <= (constraints.minSlides || 1);
    }
    if (addSlide) {
      addSlide.disabled = draftContentSlides.length >= (constraints.maxSlides || 100);
    }
    if (deleteImage) {
      deleteImage.disabled = !isImage || !config.image?.src;
    }

    setFieldsVisible(coverFields, isCover);
    setFieldsVisible(contentFields, !isCover && !isTerminalFocused);
    setFieldsVisible(imageFields, isImage);
  }

  function saveEditorFields() {
    if (editorSaveFrame) {
      window.cancelAnimationFrame(editorSaveFrame);
      editorSaveFrame = 0;
    }

    normalizeDraft();
    applyTypographyScales(false);
    const config = draftConfig.slides[editorIndex] || {};
    const isCover = editorIndex === 0 || config.type === "cover";
    if (slideMarkdown && !isCover) {
      draftContentSlides[editorIndex] = config.type === "terminalFocused" ? "" : (slideMarkdown.value.trim() ? slideMarkdown.value : "");
    }
    if (isCover) {
      draftConfig.title = coverTitle?.value.trim() || draftConfig.title || "Presentation";
      draftConfig.cover = {
        ...(draftConfig.cover || {}),
        title: draftConfig.title,
        subtitle: coverSubtitle?.value.trim() || "",
        kicker: coverSubtitle?.value.trim() || "",
        agenda: (agendaInput?.value || "")
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean)
      };
      draftConfig.presenter = {
        ...(draftConfig.presenter || {}),
        name: presenterName?.value.trim() || "",
        role: presenterRole?.value.trim() || "",
        contact: presenterContact?.value.trim() || "",
        website: presenterWebsite?.value.trim() || "",
        github: presenterGithub?.value.trim() || "",
        linkedin: presenterLinkedin?.value.trim() || ""
      };
      draftConfig.metadata = {
        ...(draftConfig.metadata || {}),
        date: metadataDate?.value.trim() || "",
        version: metadataVersion?.value.trim() || ""
      };
    }
    if (config.type === "image") {
      config.image = {
        ...(config.image || {}),
        scale: Number(imageScale?.value || 1),
        alt: imageAlt?.value.trim() || "",
        x: Number(imageX?.value || 0),
        y: Number(imageY?.value || 0)
      };
      applyImageToDom(editorIndex);
    }
    const typography = currentTypographyValues();
    applyTypographyFields(config, typography);
    config.mustReadUrl = normalizeMustReadUrl(mustReadUrl ? mustReadUrl.value : "");
    draftConfig.slides[editorIndex] = config;
    applySlideTypographyPreview(editorIndex);
  }

  function scheduleSaveEditorFields() {
    if (editorSaveFrame) {
      return;
    }

    editorSaveFrame = window.requestAnimationFrame(() => {
      editorSaveFrame = 0;
      saveEditorFields();
    });
  }

  function selectEditorIndex(index) {
    saveEditorFields();
    editorIndex = clamp(index, 0, draftContentSlides.length - 1);
    if (editorIndex < slides.length && !slideOrderDirty) {
      setActiveSlide(editorIndex);
    } else {
      loadEditor();
    }
  }

  function addDraftSlide() {
    saveEditorFields();
    if (draftContentSlides.length >= (constraints.maxSlides || 100)) {
      setEditorStatus("Slide limit reached.");
      return;
    }

    const type = templateSelect?.value || "text";
    const template = templateDefaults[type] || templateDefaults.text;
    const insertAt = clamp(editorIndex + 1, 1, draftContentSlides.length);
    const typography = currentTypographyValues();
    draftContentSlides.splice(insertAt, 0, template.markdown);
    draftConfig.slides.splice(insertAt, 0, applyTypographyFields(clone(template.config), typography));
    editorIndex = insertAt;
    loadEditor();
    setEditorStatus("Added. Save to render.");
  }

  function deleteDraftSlide() {
    saveEditorFields();
    if (editorIndex === 0 || draftContentSlides.length <= (constraints.minSlides || 1)) {
      return;
    }
    const slideNumber = editorIndex + 1;
    const slideType = draftConfig.slides[editorIndex]?.type || "text";
    const confirmed = window.confirm(`Delete slide ${slideNumber} (${slideType})? This cannot be undone.`);
    if (!confirmed) {
      return;
    }
    draftContentSlides.splice(editorIndex, 1);
    draftConfig.slides.splice(editorIndex, 1);
    editorIndex = clamp(editorIndex - 1, 0, draftContentSlides.length - 1);
    loadEditor();
    setEditorStatus("Deleted. Save to render.");
  }

  function changeTemplate(type) {
    saveEditorFields();
    if (editorIndex === 0) {
      return;
    }
    const template = templateDefaults[type] || templateDefaults.text;
    const typography = currentTypographyValues();
    const nextConfig = clone(template.config);
    applyTypographyFields(nextConfig, typography);
    draftConfig.slides[editorIndex] = nextConfig;
    if (type === "terminalFocused") {
      draftContentSlides[editorIndex] = "";
    }
    loadEditor();
    setEditorStatus("Template changed.");
  }

  function swapTerminalSides() {
    saveEditorFields();
    const config = draftConfig.slides[editorIndex] || {};
    if (config.type !== "terminalText") {
      return;
    }

    const position = terminalPosition(config);
    config.terminal = {
      ...(config.terminal || {}),
      position: position === "left" ? "right" : "left"
    };
    draftConfig.slides[editorIndex] = config;
    loadEditor();
    setEditorStatus("Terminal sides swapped.");
  }

  async function saveDraft() {
    saveEditorFields();
    normalizeDraft();
    setEditorStatus("Saving...");
    try {
      const response = await fetch("/api/presentation", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          config: draftConfig,
          contentSlides: draftContentSlides
        })
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setEditorStatus(`${payload.error || "Save failed."} HTTP ${response.status}`);
        return;
      }

      setEditorStatus("Saved.");
      window.setTimeout(() => {
        window.location.reload();
      }, 250);
    } catch (error) {
      setEditorStatus(`Save failed: ${error.message}`);
    }
  }

  function readImageFile(file) {
    if (!file || !file.type.startsWith("image/")) {
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      saveEditorFields();
      const config = draftConfig.slides[editorIndex] || {};
      const typography = currentTypographyValues();
      if (config.type !== "image") {
        draftConfig.slides[editorIndex] = applyTypographyFields(clone(templateDefaults.image.config), typography);
      }
      draftConfig.slides[editorIndex].image = {
        ...(draftConfig.slides[editorIndex].image || {}),
        src: String(reader.result || ""),
        alt: file.name || "",
        x: 0,
        y: 0,
        scale: 1
      };
      loadEditor();
      setEditorStatus("Image loaded. Save to render.");
    });
    reader.readAsDataURL(file);
  }

  const hash = Number.parseInt(window.location.hash.slice(1), 10);
  let savedTheme = null;
  let savedMode = null;
  try {
    savedTheme = window.localStorage.getItem("presentation-theme");
    savedMode = window.localStorage.getItem("presentation-mode");
  } catch {
    savedTheme = null;
    savedMode = null;
  }

  applyTheme(savedTheme === "light" ? "light" : "dark", false);
  loadCameraSettings();
  applyMode(savedMode === "edit" ? "edit" : "present", false);
  applyTypographyScales(true);
  createProgressDots();

  if (Number.isInteger(hash) && hash >= 1 && hash <= slides.length) {
    currentIndex = hash - 1;
    editorIndex = currentIndex;
  }

  setActiveSlide(currentIndex);
  loadEditor();

  window.addEventListener("keydown", (event) => {
    if (handleTypographyScaleShortcut(event)) {
      return;
    }

    if (isEditableTarget(event.target)) {
      return;
    }

    if (terminalFocused()) {
      if (event.key === "Escape") {
        event.preventDefault();
        blurTerminalFocus();
      }
      return;
    }

    if (event.key === "ArrowRight" || event.key === " " || event.key === "PageDown") {
      event.preventDefault();
      queueMove(1);
    } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
      event.preventDefault();
      queueMove(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveSlide(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveSlide(slides.length - 1);
    }
  }, { capture: true });

  window.addEventListener("resize", scheduleFitAllTerminals);
  window.addEventListener("orientationchange", scheduleFitAllTerminals);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", scheduleFitAllTerminals);
  }
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(scheduleFitAllTerminals).catch(() => {});
  }

  document.addEventListener("click", handleMarkdownCopy);

  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      applyTheme(themeMode === "dark" ? "light" : "dark");
    });
  }

  if (modeToggle) {
    modeToggle.addEventListener("click", () => {
      applyMode(mode === "edit" ? "present" : "edit");
    });
  }

  if (cameraToggle && cameraPanel) {
    cameraToggle.addEventListener("click", () => {
      const isOpen = cameraPanel.classList.toggle("open");
      cameraToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
      if (isOpen && !cameraDevicesLoaded) {
        loadCameraDevices().catch((error) => {
          setCameraStatus(`Device list failed: ${error.message}`);
        });
      }
    });
  }

  if (cameraEnable) {
    cameraEnable.addEventListener("click", () => {
      enableCameraStream().catch((error) => {
        setCameraStatus(`Camera failed: ${error.message}`);
      });
    });
  }

  if (cameraDisable) {
    cameraDisable.addEventListener("click", () => {
      stopCameraStream();
      setCameraStatus("Camera disabled.");
    });
  }

  if (cameraQuickToggle) {
    cameraQuickToggle.addEventListener("click", () => {
      if (cameraEnabled) {
        stopCameraStream();
        setCameraStatus("Camera disabled.");
        return;
      }
      enableCameraStream().catch((error) => {
        setCameraStatus(`Camera failed: ${error.message}`);
      });
    });
  }

  if (audioPlay) {
    audioPlay.addEventListener("click", () => {
      if (audioElement && !audioElement.paused) {
        stopAudio();
        return;
      }
      playAudioTrack().catch((error) => {
        setEditorStatus(`Audio failed: ${error.message}`);
      });
    });
  }

  if (audioPrevious) {
    audioPrevious.addEventListener("click", () => {
      playAudioTrack(audioIndex - 1).catch((error) => {
        setEditorStatus(`Audio failed: ${error.message}`);
      });
    });
  }

  if (audioNext) {
    audioNext.addEventListener("click", () => {
      playAudioTrack(audioIndex + 1).catch((error) => {
        setEditorStatus(`Audio failed: ${error.message}`);
      });
    });
  }

  if (audioVolume) {
    audioVolume.addEventListener("input", () => {
      if (audioElement) {
        audioElement.volume = desiredAudioVolume();
      }
    });
  }

  [cameraPosition, cameraSize, cameraZoom].forEach((element) => {
    if (element) {
      element.addEventListener("input", () => {
        persistCameraSettings();
        updateCameraVisibility();
        setCameraStatus(cameraEnabled ? "Camera layout updated." : "Camera layout ready.");
      });
    }
  });

  if (cameraSource) {
    cameraSource.addEventListener("change", () => {
      persistCameraSettings();
      if (!cameraEnabled) {
        return;
      }
      enableCameraStream().catch((error) => {
        setCameraStatus(`Camera failed: ${error.message}`);
      });
    });
  }

  if (cameraMicrophone) {
    cameraMicrophone.addEventListener("change", () => {
      persistCameraSettings();
      if (!cameraEnabled) {
        return;
      }
      enableCameraStream().catch((error) => {
        setCameraStatus(`Camera failed: ${error.message}`);
      });
    });
  }

  if (slideSelect) {
    slideSelect.addEventListener("change", () => {
      selectEditorIndex(Number.parseInt(slideSelect.value, 10));
    });
  }

  if (slideOrderList) {
    slideOrderList.addEventListener("dragover", (event) => {
      const target = slideOrderTargetFromEvent(event);
      if (!target || target.index === 0) {
        return;
      }

      event.preventDefault();
      const rect = target.item.getBoundingClientRect();
      const position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
      markSlideOrderDropState(target.index, position);
      event.dataTransfer.dropEffect = "move";
    });

    slideOrderList.addEventListener("drop", (event) => {
      const target = slideOrderTargetFromEvent(event);
      if (!target || target.index === 0 || slideOrderDragIndex < 1) {
        event.preventDefault();
        clearSlideOrderDropState();
        return;
      }

      event.preventDefault();
      const rect = target.item.getBoundingClientRect();
      const position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
      reorderActiveSlide(slideOrderDragIndex, target.index, position);
      slideOrderDragIndex = -1;
      clearSlideOrderDropState();
    });

    slideOrderList.addEventListener("dragend", () => {
      slideOrderDragIndex = -1;
      clearSlideOrderDropState();
    });
  }

  if (templateSelect) {
    templateSelect.addEventListener("change", () => {
      changeTemplate(templateSelect.value);
    });
  }

  if (terminalSwap) {
    terminalSwap.addEventListener("click", swapTerminalSides);
  }

  if (addSlide) {
    addSlide.addEventListener("click", addDraftSlide);
  }

  if (deleteSlide) {
    deleteSlide.addEventListener("click", deleteDraftSlide);
  }

  if (saveSlides) {
    saveSlides.addEventListener("click", () => {
      saveDraft().catch((error) => {
        console.error(error);
        setEditorStatus(`Save failed: ${error.message}`);
      });
    });
  }

  [slideMarkdown, coverTitle, coverSubtitle, presenterName, presenterRole, presenterContact, presenterWebsite, presenterGithub, presenterLinkedin, metadataDate, metadataVersion, agendaInput, headingScaleInput, bodyScaleInput, mustReadUrl, imageScale, imageAlt, imageX, imageY].forEach((element) => {
    if (element) {
      element.addEventListener("input", scheduleSaveEditorFields);
    }
  });

  if (imageFile) {
    imageFile.addEventListener("change", () => {
      readImageFile(imageFile.files?.[0]);
    });
  }

  if (deleteImage) {
    deleteImage.addEventListener("click", () => {
      if (mode !== "edit") {
        return;
      }
      const config = draftConfig.slides[editorIndex] || {};
      if (config.type !== "image" || !config.image?.src) {
        return;
      }
      const confirmed = window.confirm("Delete this image from the slide? The file will be removed on save if nothing else uses it.");
      if (!confirmed) {
        return;
      }
      clearImageConfig(editorIndex);
      loadEditor();
      setEditorStatus("Image removed. Save to delete the file.");
    });
  }

  if (imageDrop) {
    imageDrop.addEventListener("dragover", (event) => {
      event.preventDefault();
      imageDrop.classList.add("active");
    });
    imageDrop.addEventListener("dragleave", () => {
      imageDrop.classList.remove("active");
    });
    imageDrop.addEventListener("drop", (event) => {
      event.preventDefault();
      imageDrop.classList.remove("active");
      readImageFile(event.dataTransfer?.files?.[0]);
    });
  }

  window.addEventListener("paste", (event) => {
    if (mode !== "edit" || draftConfig.slides[editorIndex]?.type !== "image") {
      return;
    }
    const item = Array.from(event.clipboardData?.items || []).find((clipboardItem) => clipboardItem.type.startsWith("image/"));
    if (item) {
      readImageFile(item.getAsFile());
    }
  });

  if (deck) {
    deck.addEventListener("pointerdown", beginImageEdit);
    deck.addEventListener("pointermove", moveImageEdit);
    deck.addEventListener("pointerup", finishImageEdit);
    deck.addEventListener("pointercancel", finishImageEdit);
    deck.addEventListener("wheel", wheelImageEdit, { passive: false });
  }

  window.addEventListener("beforeunload", () => {
    stopAudio();
    stopCameraStream();
    terminalStates.forEach((state) => {
      disposeTerminalState(state);
    });
  });
})();
