import { searchAddresses } from "@/lib/law/store";

// GET /api/addresses?q=clinton hoboken -> up to 12 sample addresses
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.slice(0, 120) ?? "";
  return Response.json(
    searchAddresses(q).map((a) => ({
      address_id: a.address_id,
      street_address: a.street_address,
      postal_city: a.postal_city,
      legal_city: a.legal_city,
      state: a.state,
      zip: a.zip,
    })),
  );
}
