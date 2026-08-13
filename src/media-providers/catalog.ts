import type { MediaProvider, ProviderTier, SearchRequest, MediaCandidate } from "./types.js";
import { PexelsProvider } from "./pexels.js";
import { PixabayProvider } from "./pixabay.js";
import { WikimediaProvider } from "./wikimedia.js";
import { EuropeanaProvider } from "./europeana.js";
import { InternetArchiveProvider } from "./internet-archive.js";
import { SmithsonianProvider } from "./smithsonian.js";

export interface ProviderDescriptor {
  id: string;
  tier: ProviderTier;
  credential?: string;
  enabledByDefault: boolean;
}

export const PROVIDER_CATALOG: ProviderDescriptor[] = [
  { id: "pixabay", tier: "free", credential: "PIXABAY_API_KEY", enabledByDefault: true },
  { id: "pexels", tier: "free", credential: "PEXELS_API_KEY", enabledByDefault: true },
  { id: "coverr", tier: "free", enabledByDefault: true },
  { id: "nasa-images", tier: "open", enabledByDefault: true },
  { id: "nasa-svs", tier: "open", enabledByDefault: true },
  { id: "wikimedia", tier: "open", enabledByDefault: true },
  { id: "internet-archive", tier: "open", enabledByDefault: true },
  { id: "europeana", tier: "open", credential: "EUROPEANA_API_KEY", enabledByDefault: true },
  { id: "smithsonian", tier: "open", credential: "SMITHSONIAN_API_KEY", enabledByDefault: true },
  { id: "freepik", tier: "paid", credential: "FREEPIK_API_KEY", enabledByDefault: false },
  {
    id: "motion-elements",
    tier: "paid",
    credential: "MOTION_ELEMENTS_API_KEY",
    enabledByDefault: false,
  },
  { id: "shutterstock", tier: "paid", credential: "SHUTTERSTOCK_API_KEY", enabledByDefault: false },
  { id: "vecteezy", tier: "paid", credential: "VECTEEZY_API_KEY", enabledByDefault: false },
  {
    id: "storyblocks",
    tier: "enterprise",
    credential: "STORYBLOCKS_API_KEY",
    enabledByDefault: false,
  },
  { id: "getty", tier: "enterprise", credential: "GETTY_API_KEY", enabledByDefault: false },
  {
    id: "adobe-stock",
    tier: "enterprise",
    credential: "ADOBE_STOCK_API_KEY",
    enabledByDefault: false,
  },
  { id: "agnes", tier: "generated", credential: "AGNES_API_KEY", enabledByDefault: true },
];

export class UnconfiguredProvider implements MediaProvider {
  constructor(
    readonly id: string,
    readonly tier: ProviderTier,
    _credential?: string,
  ) {}

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async search(_request: SearchRequest, _signal?: AbortSignal): Promise<MediaCandidate[]> {
    return [];
  }
}

export async function availableMediaProviders(
  providers: MediaProvider[] = createProviderCatalog(),
): Promise<MediaProvider[]> {
  const availability = await Promise.all(providers.map((provider) => provider.isAvailable()));
  return providers.filter((_, index) => availability[index]);
}

export function createProviderCatalog(): MediaProvider[] {
  return PROVIDER_CATALOG.map((item) => {
    if (item.id === "pexels") return new PexelsProvider();
    if (item.id === "pixabay") return new PixabayProvider();
    if (item.id === "wikimedia") return new WikimediaProvider();
    if (item.id === "internet-archive") return new InternetArchiveProvider();
    if (item.id === "europeana") return new EuropeanaProvider();
    if (item.id === "smithsonian") return new SmithsonianProvider();
    return new UnconfiguredProvider(item.id, item.tier, item.credential);
  });
}
