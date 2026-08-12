import type { MediaProvider, ProviderTier, SearchRequest, MediaCandidate } from "./types.js";
import { PexelsProvider } from "./pexels.js";
import { PixabayProvider } from "./pixabay.js";

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
    private readonly credential?: string,
  ) {}

  async isAvailable(): Promise<boolean> {
    return this.credential ? Boolean(process.env[this.credential]) : false;
  }

  async search(_request: SearchRequest, _signal?: AbortSignal): Promise<MediaCandidate[]> {
    if (!(await this.isAvailable())) return [];
    throw new Error(`${this.id} adapter requires provider-specific API configuration`);
  }
}

export function createProviderCatalog(): MediaProvider[] {
  return PROVIDER_CATALOG.map((item) => {
    if (item.id === "pexels") return new PexelsProvider();
    if (item.id === "pixabay") return new PixabayProvider();
    return new UnconfiguredProvider(item.id, item.tier, item.credential);
  });
}
