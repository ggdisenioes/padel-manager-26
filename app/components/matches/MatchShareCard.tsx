import React from "react";

type Props = {
  winnerTeam: string;
  loserTeam: string;
  score: string;
};

const MatchShareCard = React.forwardRef<HTMLDivElement, Props>(
  ({ winnerTeam, loserTeam, score }, ref) => {
    return (
      <div
        ref={ref}
        className="w-[360px] bg-white rounded-2xl border p-6 text-center space-y-4 shadow"
      >
        <h2 className="text-xl font-extrabold text-green-700">
          Twinco Padel Manager
        </h2>

        <div>
          <p className="text-xs text-gray-500">🏆 Ganadores</p>
          <p className="text-lg font-semibold">{winnerTeam}</p>
        </div>

        <p className="text-4xl font-extrabold text-gray-900">
          {score}
        </p>

        <div>
          <p className="text-xs text-gray-500">Perdedores</p>
          <p className="text-base">{loserTeam}</p>
        </div>
      </div>
    );
  }
);

MatchShareCard.displayName = "MatchShareCard";
export default MatchShareCard;