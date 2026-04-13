import { NextResponse } from "next/server";

const disabledResponse = () =>
  NextResponse.json(
    { error: "Desafíos deshabilitados temporalmente" },
    { status: 410 }
  );

export const PUT = disabledResponse;
export const DELETE = disabledResponse;
