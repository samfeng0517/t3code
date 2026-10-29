import type { ReactNode, SVGAttributes } from "react";
import type { SourceControlProviderInfo } from "@t3tools/contracts";
import {
  capitalizeTerm,
  sourceControlClients,
} from "@t3tools/client-runtime/source-control-clients";
import type {
  ChangeRequestTerminology,
  SourceControlDefinition,
} from "@t3tools/client-runtime/source-control-clients";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { SourceControlIconArtwork } from "./components/SourceControlIconArtwork";

export type { ChangeRequestTerminology } from "@t3tools/client-runtime/source-control-clients";

export type SourceControlIcon = (props: SVGAttributes<SVGSVGElement>) => ReactNode;

const SOURCE_CONTROL_ICONS = new WeakMap<SourceControlDefinition, SourceControlIcon>();

/** One component per definition, so a host's icon keeps its identity across renders. */
export function sourceControlIcon(definition: SourceControlDefinition): SourceControlIcon {
  const artwork = definition.icon;
  if (artwork === null) return PullRequestGlyph.pullRequest;
  let Icon = SOURCE_CONTROL_ICONS.get(definition);
  if (Icon === undefined) {
    Icon = (props: SVGAttributes<SVGSVGElement>) => (
      <SourceControlIconArtwork {...props} icon={artwork} />
    );
    SOURCE_CONTROL_ICONS.set(definition, Icon);
  }
  return Icon;
}

export interface SourceControlPresentation {
  readonly definition: SourceControlDefinition;
  readonly providerName: string;
  readonly terminology: ChangeRequestTerminology;
  readonly Icon: SourceControlIcon;
}

function presentDefinition(
  definition: SourceControlDefinition,
  providerName: string,
): SourceControlPresentation {
  return {
    definition,
    providerName,
    terminology: definition.changeRequest,
    Icon: sourceControlIcon(definition),
  };
}

export function getSourceControlPresentation(
  provider: SourceControlProviderInfo | null | undefined,
): SourceControlPresentation {
  const definition = sourceControlClients.get(provider?.kind);
  return presentDefinition(definition, provider?.name || definition.label);
}

export function getSourceControlPresentationForKind(kind: string): SourceControlPresentation {
  const definition = sourceControlClients.get(kind);
  return presentDefinition(definition, definition.label);
}

/**
 * A project's host for change request markers. The default host and unrecognized hosts keep
 * the generic glyph, so only another host (GitLab, Bitbucket...) swaps in its own logo.
 */
export function getProjectSourceControlPresentation(
  kind: string | null | undefined,
): SourceControlPresentation {
  const fallback = sourceControlClients.get(undefined);
  const definition = (kind ? sourceControlClients.find(kind) : undefined) ?? fallback;
  const presentation = presentDefinition(definition, definition.label);
  return definition === fallback
    ? { ...presentation, Icon: PullRequestGlyph.pullRequest }
    : presentation;
}

/** Message params for copy that names a host's change request ("pull request", "MR"). */
export function changeRequestTermParams(terminology: ChangeRequestTerminology) {
  return {
    singular: terminology.singular,
    plural: terminology.plural,
    shortLabel: terminology.shortLabel,
    Singular: capitalizeTerm(terminology.singular),
    Plural: capitalizeTerm(terminology.plural),
    title: terminology.singular.split(" ").map(capitalizeTerm).join(" "),
  };
}
