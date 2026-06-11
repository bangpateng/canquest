/**
 * Response shape for GET /api/party/transfer-offers
 */
export interface TransferOfferItemDto {
  contractId: string;
  senderParty: string;
  senderUsername: string;
  amount: string;
  description: string;
  expiresAtMicros: string;
  createdAt?: string;
  incoming: boolean;
}

/**
 * Request body for POST /api/party/accept-offer
 */
export interface AcceptOfferDto {
  contractId: string;
}
