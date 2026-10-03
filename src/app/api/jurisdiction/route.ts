import { geocode } from "@/lib/geocode";

// GET /api/jurisdiction?address=... -> { state, county, place, matchedAddress, lat, lon }
export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address")?.trim() ?? "";
  if (!address) return Response.json({ error: "Pass ?address=..." }, { status: 400 });
  if (address.length > 300) return Response.json({ error: "Address is too long." }, { status: 413 });

  try {
    const jurisdiction = await geocode(address, request.signal);
    if (!jurisdiction) {
      return Response.json({ error: "Address not found. Include street, city, state and ZIP." }, { status: 404 });
    }
    return Response.json(jurisdiction);
  } catch (err) {
    console.error("[api/jurisdiction]", err);
    return Response.json({ error: "The address lookup service is unavailable. Try again." }, { status: 502 });
  }
}
