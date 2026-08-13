import { fetchJson } from "./http.js";
import { openLicenseEvidence } from "./open-license.js";
import { runPool } from "../scheduler/pool.js";
import type { MediaCandidate, MediaProvider, SearchRequest } from "./types.js";

interface EuropeanaItem {
  id: string;
  title?: string[];
  link?: string;
  provider?: string[];
  rights?: string[];
}
interface EuropeanaResource {
  about?: string;
  ebucoreHasMimeType?: string;
  ebucoreWidth?: number;
  ebucoreHeight?: number;
  webResourceEdmRights?: { def?: string[] };
}
interface EuropeanaRecord {
  object?: {
    aggregations?: Array<{
      edmIsShownAt?: string;
      edmRights?: { def?: string[] };
      webResources?: EuropeanaResource[];
    }>;
    europeanaAggregation?: { edmLandingPage?: string };
    proxies?: Array<{ dcCreator?: { def?: string[] }; dcTitle?: { def?: string[] } }>;
  };
}

export class EuropeanaProvider implements MediaProvider {
  readonly id = "europeana";
  readonly tier = "open" as const;
  constructor(private readonly apiKey = process.env.EUROPEANA_API_KEY) {}

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  async search(request: SearchRequest, signal?: AbortSignal): Promise<MediaCandidate[]> {
    if (!this.apiKey) return [];
    const url = new URL("https://api.europeana.eu/record/v2/search.json");
    url.search = new URLSearchParams({
      wskey: this.apiKey,
      query: request.query,
      qf: "TYPE:IMAGE",
      rows: String(Math.min(request.limit, 100)),
      profile: "rich",
    }).toString();
    const search = await fetchJson<{ items?: EuropeanaItem[] }>(url, {}, signal);
    const records = await runPool(
      search.items ?? [],
      () => 6,
      async (item) => {
        if (!(item.rights ?? []).some((right) => openLicenseEvidence(right))) return [];
        const detailUrl = new URL(`https://api.europeana.eu/record${item.id}.json`);
        detailUrl.searchParams.set("wskey", this.apiKey!);
        const record = await fetchJson<EuropeanaRecord>(detailUrl, {}, signal);
        const aggregation = record.object?.aggregations?.[0];
        if (!aggregation) return [];
        const proxy = record.object?.proxies?.find((value) => value.dcCreator || value.dcTitle);
        return (aggregation.webResources ?? []).flatMap((resource, index) => {
          const rights = resource.webResourceEdmRights?.def?.[0];
          const evidence = rights
            ? openLicenseEvidence(rights, `Europeana attached ${rights} to this web resource.`)
            : null;
          const creator = proxy?.dcCreator?.def?.[0];
          if (
            !evidence ||
            (evidence.attributionRequired && !creator) ||
            !resource.about?.startsWith("https://") ||
            !resource.ebucoreHasMimeType?.startsWith("image/") ||
            !resource.ebucoreWidth ||
            !resource.ebucoreHeight ||
            resource.ebucoreWidth < 720 ||
            resource.ebucoreHeight < 720
          )
            return [];
          return [
            {
              id: `europeana-${item.id}-${index}`.replace(/[^a-z0-9_-]/gi, "-"),
              provider: this.id,
              tier: this.tier,
              kind: "image" as const,
              previewUrl: resource.about,
              sourceUrl:
                record.object?.europeanaAggregation?.edmLandingPage ??
                aggregation.edmIsShownAt ??
                item.link ??
                resource.about,
              downloadUrl: resource.about,
              author: creator ?? item.provider?.[0] ?? "Europeana contributor",
              width: resource.ebucoreWidth,
              height: resource.ebucoreHeight,
              watermarked: false,
              motionScore: 0,
              semanticScore: 0.66,
              compositionScore: 0.68,
              styleScore: 0.68,
              license: evidence,
            },
          ];
        });
      },
    );
    const candidates = records.flatMap((record) =>
      record.status === "fulfilled" ? record.value : [],
    );
    const failures = records.filter((record) => record.status === "rejected");
    if (!candidates.length && failures.length)
      throw new AggregateError(
        failures.map((record) => (record as PromiseRejectedResult).reason),
        "Europeana record requests failed",
      );
    return candidates;
  }
}
