import React, { useRef } from "react";
import Image from "next/image";

type Props = {
  winnerTeam: string;
  loserTeam: string;
  score: string;
};

const MatchShareCard = React.forwardRef<HTMLDivElement, Props>(
  ({ winnerTeam, loserTeam, score }, ref) => {
    const localRef = useRef<HTMLDivElement>(null);
    const cardRef = (ref as React.RefObject<HTMLDivElement>) || localRef;

    const generateImage = async () => {
      try {
        const { toPng } = await import("html-to-image");
        if (!cardRef.current) return null;
        return await toPng(cardRef.current, {
          cacheBust: true,
          backgroundColor: "#020617",
        });
      } catch (err: any) {
        if (err?.name === "AbortError") return null;
        console.error("Error generando imagen", err);
        return null;
      }
    };

    const handleDownload = async () => {
      const dataUrl = await generateImage();
      if (!dataUrl) return;

      const link = document.createElement("a");
      link.download = "resultado-padel.png";
      link.href = dataUrl;
      link.click();
    };

    const handleShare = async () => {
      const dataUrl = await generateImage();
      if (!dataUrl) return;

      try {
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        const file = new File([blob], "resultado-padel.png", {
          type: "image/png",
        });

        if (navigator.share) {
          await navigator.share({
            files: [file],
            title: "Resultado del partido",
            text: "Resultado del partido de pádel",
          });
        } else {
          await handleDownload();
        }
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        console.error("Error al compartir", err);
      }
    };

    return (
      <div className="flex flex-col items-center gap-4">
        <div
          ref={cardRef}
          style={{
            width: 600,
            height: 600,
            background: "linear-gradient(180deg, #020617, #020617)",
            borderRadius: 24,
            padding: 40,
            color: "white",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            fontFamily: "Inter, system-ui, sans-serif",
          }}
        >
          {/* HEADER */}
          <div style={{ textAlign: "center" }}>
            <Image
              src="/logo.png"
              alt="Twinco Padel Manager"
              width={220}
              height={60}
              priority
              style={{ margin: "0 auto" }}
            />
            <div
              style={{
                marginTop: 8,
                fontSize: 12,
                letterSpacing: 2,
                color: "#4ade80",
              }}
            >
              PADEL MANAGER
            </div>
          </div>

          {/* RESULTADO */}
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                color: "#4ade80",
                fontSize: 22,
                fontWeight: 700,
                marginBottom: 12,
              }}
            >
              {winnerTeam}
            </div>

            <div
              style={{
                fontSize: 72,
                fontWeight: 800,
                margin: "12px 0",
              }}
            >
              {score}
            </div>

            <div
              style={{
                color: "#f87171",
                fontSize: 18,
              }}
            >
              {loserTeam}
            </div>
          </div>

          {/* FOOTER */}
          <div
            style={{
              textAlign: "center",
              fontSize: 12,
              opacity: 0.6,
            }}
          >
            twinco.padelx.es
          </div>
        </div>

        {/* ACTIONS */}
        <div className="flex gap-3">
          <button
            onClick={handleShare}
            className="px-4 py-2 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700 transition"
          >
            Compartir imagen
          </button>
          <button
            onClick={handleDownload}
            className="px-4 py-2 rounded-lg bg-gray-800 text-white font-semibold hover:bg-gray-900 transition"
          >
            Descargar imagen
          </button>
        </div>
      </div>
    );
  }
);

MatchShareCard.displayName = "MatchShareCard";
export default MatchShareCard;