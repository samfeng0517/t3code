import { Alert, AlertDescription } from "../ui/alert";
import type { AuthSessionState } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import React, { startTransition, useEffect, useEffectEvent, useRef, useState } from "react";

import { APP_DISPLAY_NAME } from "../../branding";
import { connectPairing } from "../../connection/onboarding";
import {
  peekPairingTokenFromUrl,
  stripPairingTokenFromUrl,
  submitServerAuthCredential,
} from "../../environments/primary";
import { readHostedPairingRequest } from "../../hostedPairing";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { StandalonePage, StandalonePageHeader } from "../ui/standalone-page";
import { useAtomCommand } from "../../state/use-atom-command";
import { t as translateNow, type Translate, useT } from "../../i18n";

export function PairingPendingSurface() {
  const t = useT();
  return (
    <StandalonePage tone="pairing">
      <StandalonePageHeader
        eyebrow={APP_DISPLAY_NAME}
        title={t("onboarding.pairingRoute.pendingTitle")}
        description={t("onboarding.pairingRoute.pendingDescription")}
      />
    </StandalonePage>
  );
}

export function PairingRouteSurface({
  auth,
  initialErrorMessage,
  onAuthenticated,
}: {
  auth: AuthSessionState["auth"];
  initialErrorMessage?: string;
  onAuthenticated: () => void;
}) {
  const t = useT();
  const [autoPairToken] = useState(peekPairingTokenFromUrl);
  const [credential, setCredential] = useState(autoPairToken ?? "");
  const [errorMessage, setErrorMessage] = useState(initialErrorMessage ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const autoSubmitAttemptedRef = useRef(false);

  const submitCredential = async (nextCredential: string) => {
    setIsSubmitting(true);
    setErrorMessage("");

    const submitError = await submitServerAuthCredential(nextCredential).then(
      () => null,
      (error) => errorMessageFromUnknown(error),
    );

    setIsSubmitting(false);

    if (submitError) {
      setErrorMessage(submitError);
      return;
    }

    startTransition(() => {
      onAuthenticated();
    });
  };

  const handleSubmit = async (event?: React.SubmitEvent<HTMLFormElement>) => {
    event?.preventDefault();
    await submitCredential(credential);
  };

  const autoSubmit = useEffectEvent((token: string) => {
    void submitCredential(token);
  });

  useEffect(() => {
    if (!autoPairToken || autoSubmitAttemptedRef.current) {
      return;
    }

    autoSubmitAttemptedRef.current = true;
    stripPairingTokenFromUrl();
    autoSubmit(autoPairToken);
  }, [autoPairToken]);

  return (
    <StandalonePage tone="pairing">
      <StandalonePageHeader
        eyebrow={APP_DISPLAY_NAME}
        title={t("onboarding.pairingRoute.title")}
        description={describeAuthGate(auth.bootstrapMethods, t)}
      />

      <form className="mt-6 space-y-4" onSubmit={(event) => void handleSubmit(event)}>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="pairing-token">
            {t("onboarding.pairingRoute.tokenLabel")}
          </label>
          <Input
            id="pairing-token"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            disabled={isSubmitting}
            nativeInput
            onChange={(event) => setCredential(event.currentTarget.value)}
            placeholder={t("onboarding.pairingRoute.tokenPlaceholder")}
            spellCheck={false}
            value={credential}
          />
        </div>

        {errorMessage ? (
          <Alert variant="error">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button disabled={isSubmitting} size="sm" type="submit">
            {isSubmitting ? t("onboarding.pairing.pairing") : t("common.continue")}
          </Button>
          <Button
            disabled={isSubmitting}
            onClick={() => window.location.reload()}
            size="sm"
            variant="outline"
          >
            {t("onboarding.reloadApp")}
          </Button>
        </div>
      </form>

      <div className="mt-6 rounded-lg border border-border/70 bg-background/55 px-3 py-3 text-xs leading-relaxed text-muted-foreground">
        {describeSupportedMethods(auth.bootstrapMethods, t)}
      </div>
    </StandalonePage>
  );
}

export function HostedPairingRouteSurface() {
  const t = useT();
  const connectPairingEnvironment = useAtomCommand(connectPairing, {
    reportFailure: false,
  });
  const [request] = useState(readHostedPairingRequest);
  const [status, setStatus] = useState<"pairing" | "paired" | "error">(
    request ? "pairing" : "error",
  );
  const [message, setMessage] = useState(() =>
    request
      ? t("onboarding.hostedPairing.connecting")
      : t("onboarding.hostedPairing.missingRequest"),
  );
  const [canRetry, setCanRetry] = useState(false);
  const submitAttemptedRef = useRef(false);
  const tokenSubmittedRef = useRef(false);

  const submitHostedPairingRequest = async () => {
    if (!request) {
      setStatus("error");
      setMessage(t("onboarding.hostedPairing.missingRequest"));
      setCanRetry(false);
      return;
    }

    if (tokenSubmittedRef.current) {
      setStatus("error");
      setMessage(t("onboarding.hostedPairing.tokenAlreadySubmitted"));
      setCanRetry(false);
      return;
    }

    setStatus("pairing");
    setMessage(t("onboarding.hostedPairing.connecting"));
    setCanRetry(false);
    tokenSubmittedRef.current = true;

    const result = await connectPairingEnvironment({
      host: request.host,
      pairingCode: request.token,
    });
    if (result._tag === "Success") {
      setStatus("paired");
      setMessage(
        t("onboarding.hostedPairing.paired", {
          environment: request.label || t("onboarding.hostedPairing.theEnvironment"),
        }),
      );
      return;
    }

    tokenSubmittedRef.current = false;
    setStatus("error");
    setCanRetry(true);
    setMessage(
      t("onboarding.hostedPairing.failedRetryHint", {
        error: errorMessageFromUnknown(squashAtomCommandFailure(result)),
      }),
    );
  };

  const submitOnMount = useEffectEvent(() => {
    void submitHostedPairingRequest();
  });

  useEffect(() => {
    if (submitAttemptedRef.current) {
      return;
    }
    submitAttemptedRef.current = true;

    stripPairingTokenFromUrl();
    submitOnMount();
  }, []);

  return (
    <StandalonePage tone="pairing">
      <StandalonePageHeader
        eyebrow={APP_DISPLAY_NAME}
        title={
          status === "paired"
            ? t("onboarding.hostedPairing.title.paired")
            : status === "error"
              ? t("onboarding.hostedPairing.title.failed")
              : t("onboarding.hostedPairing.title.pairing")
        }
        description={message}
      />

      {request ? (
        <div className="mt-5 rounded-lg border border-border/70 bg-background/55 px-3 py-3 text-xs leading-relaxed text-muted-foreground">
          {t("onboarding.hostedPairing.host")}
          <span className="font-mono text-foreground/80">{request.host}</span>
        </div>
      ) : null}

      {status === "error" ? (
        <Alert variant="error" className="mt-5">
          <AlertDescription>{t("onboarding.hostedPairing.reachabilityHint")}</AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2">
        {status === "pairing" ? (
          <Button disabled size="sm">
            {t("onboarding.pairing.pairing")}
          </Button>
        ) : canRetry ? (
          <Button size="sm" onClick={() => void submitHostedPairingRequest()}>
            {t("onboarding.tryAgain")}
          </Button>
        ) : null}
        {status === "paired" ? (
          <Button size="sm" variant="outline" onClick={() => (window.location.href = "/")}>
            {t("onboarding.hostedPairing.openApp")}
          </Button>
        ) : null}
      </div>
    </StandalonePage>
  );
}

function errorMessageFromUnknown(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return translateNow("onboarding.pairingRoute.authFailed");
}

function describeAuthGate(bootstrapMethods: ReadonlyArray<string>, t: Translate): string {
  if (bootstrapMethods.includes("desktop-bootstrap")) {
    return t("onboarding.pairingRoute.gate.desktop");
  }

  return t("onboarding.pairingRoute.gate.token");
}

function describeSupportedMethods(bootstrapMethods: ReadonlyArray<string>, t: Translate): string {
  if (
    bootstrapMethods.includes("desktop-bootstrap") &&
    bootstrapMethods.includes("one-time-token")
  ) {
    return t("onboarding.pairingRoute.methods.both");
  }

  if (bootstrapMethods.includes("desktop-bootstrap")) {
    return t("onboarding.pairingRoute.methods.desktop");
  }

  return t("onboarding.pairingRoute.methods.token");
}
