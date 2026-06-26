export {};

declare global {
  interface Window {
    /** Timestamp fetch terakhir history harga CC (throttle di cc-price-card). */
    __ccHistAt?: number;
  }
}
