<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useStorage } from "@vueuse/core";
import { Save } from "@lucide/vue";
import type { SharePayload } from "@/types";
import { DEFAULT_INSTANCE_URL, STORAGE_KEY } from "@/constants";
import MediaPreview from "@/components/MediaPreview.vue";
import ProviderLinks from "@/components/ProviderLinks.vue";
import {
  createMusicAssistantUrl,
  decodeSharePayload,
  parseInstanceUrl,
  ShareLinkCompatibilityError,
} from "@/helpers/share";

const payload = ref<SharePayload | null>(null);
const maUrl = useStorage(STORAGE_KEY, "");
const decodeError = ref("");
const error = ref("");
let decodeGeneration = 0;
let acceptedFragment = "";

const pageTitle = computed(() => {
  if (!payload.value?.title) return "Music Assistant – Open in your instance";
  return `${payload.value.title} – Music Assistant`;
});

watch(
  pageTitle,
  (title) => {
    document.title = title;
  },
  { immediate: true }
);

async function decodePayload(): Promise<void> {
  const generation = ++decodeGeneration;
  payload.value = null;
  decodeError.value = "";
  error.value = "";
  acceptedFragment = "";
  const raw = location.hash.slice(1);
  if (!raw) {
    decodeError.value = "No share data found in URL.";
    return;
  }
  try {
    const candidate = await decodeSharePayload(raw);
    if (generation !== decodeGeneration) return;
    payload.value = candidate;
    acceptedFragment = raw;
  } catch (cause) {
    if (generation !== decodeGeneration) return;
    decodeError.value =
      cause instanceof ShareLinkCompatibilityError
        ? cause.message
        : "Could not decode share link. It may be corrupted.";
  }
}

function saveUrl(): void {
  try {
    parseInstanceUrl(maUrl.value);
    error.value = "";
  } catch {
    error.value = "Please enter a valid HTTP or HTTPS URL.";
  }
}

function openInMusicAssistant(): void {
  const raw = location.hash.slice(1);
  if (!payload.value || raw !== acceptedFragment) {
    error.value = "No share data found.";
    return;
  }
  try {
    const url = createMusicAssistantUrl(maUrl.value, raw);
    window.open(url, "_blank", "noopener,noreferrer");
    error.value = "";
  } catch {
    error.value = "Please enter a valid HTTP or HTTPS URL.";
  }
}

onMounted(() => {
  decodePayload();
  window.addEventListener("hashchange", decodePayload);

  if (!maUrl.value) {
    maUrl.value = DEFAULT_INSTANCE_URL;
  }
});

onBeforeUnmount(() => {
  ++decodeGeneration;
  window.removeEventListener("hashchange", decodePayload);
});
</script>

<template>
  <div class="card">
    <MediaPreview :payload="payload" :failed="!!decodeError" />

    <ProviderLinks v-if="payload?.provider_urls" :links="payload.provider_urls" />

    <p class="hint mb-3">
      <label for="instance-url">
        Enter the URL of your Music Assistant instance to open this shared item.
      </label>
    </p>

    <div class="url-row">
      <input
        id="instance-url"
        v-model.trim="maUrl"
        type="url"
        aria-describedby="instance-url-hint"
        placeholder="http://musicassistant.local:8095"
        class="url-input"
        @keyup.enter="openInMusicAssistant"
      />
      <button
        @click="saveUrl"
        class="btn-save"
        title="Save MA URL"
        aria-label="Save Music Assistant URL"
      >
        <Save :size="18" aria-hidden="true" />
      </button>
    </div>

    <p id="instance-url-hint" class="hint mb-4">This URL is only stored in your browser.</p>

    <button @click="openInMusicAssistant" class="btn-open" :disabled="!payload">
      Open in Music Assistant
    </button>

    <div v-if="decodeError" class="error" role="alert">
      {{ decodeError }}
    </div>
    <div v-if="error" class="error" role="alert">
      {{ error }}
    </div>
    <footer class="mt-6 text-center text-xs text-(--color-text-secondary)">
      <a
        href="https://www.openhomefoundation.org/"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center justify-center gap-2 hover:underline"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 240 356"
          width="24"
          height="24"
          class="shrink-0"
          aria-hidden="true"
        >
          <path
            d="M130.992 4.78147C124.939 -1.30395 115.034 -1.30395 109.008 4.78147L11.0056 103.307C4.95251 109.393 0 121.405 0 129.994V219.352C0 227.94 6.9964 235 15.565 235H224.435C232.977 235 240 227.966 240 219.352V129.994C240 121.405 235.048 109.393 228.994 103.307L130.992 4.78147Z"
            fill="currentColor"
          />
          <path
            d="M228 275C234.627 275 240 280.373 240 287V344C240 350.627 234.627 356 228 356H213C206.373 356 201 350.627 201 344V314H39V344C39 350.627 33.6274 356 27 356H12C5.37258 356 0 350.627 0 344V287C0 280.373 5.37258 275 12 275H228Z"
            fill="currentColor"
            opacity="0.6"
          />
        </svg>
        <span>Music Assistant is a product from the Open Home Foundation</span>
      </a>
    </footer>
  </div>
</template>

<style scoped>
.card {
  background: var(--color-bg-secondary);
  border-radius: 12px;
  padding: 1rem;
  max-width: 560px;
  width: 100%;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.28);
}

.url-row {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.url-input {
  flex: 1;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  color: var(--color-text-primary);
  font-size: 0.9rem;
  padding: 0.6rem 0.75rem;
  outline: none;
  transition: border-color 0.15s;
}

.url-input:focus {
  border-color: var(--color-accent);
}

button {
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.95rem;
  font-weight: 600;
  padding: 0.75rem 1.25rem;
  transition: opacity 0.15s;
}

button:hover {
  opacity: 0.85;
}

.btn-open {
  width: 100%;
  background: var(--color-accent);
  color: #000;
  margin-bottom: 0.75rem;
}

.btn-open:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.btn-save {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 42px;
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
  padding: 0;
}

.hint {
  font-size: 0.78rem;
  color: #666;
  margin-top: 0.5rem;
  text-align: center;
}

.error {
  background: rgba(207, 102, 121, 0.12);
  border: 1px solid rgba(207, 102, 121, 0.4);
  border-radius: 8px;
  padding: 0.75rem 1rem;
  font-size: 0.85rem;
  color: var(--color-error);
  margin-top: 1rem;
}
</style>
