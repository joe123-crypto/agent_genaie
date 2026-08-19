import type { Metadata } from "next";
import { Mailbox, ShieldCheck, Smartphone, type LucideIcon } from "lucide-react";
import { pageMetadata } from "@/src/lib/site-metadata";

export const metadata: Metadata = pageMetadata({
  title: "Genaie | Payment",
  description:
    "Pay for your Genaie plan by manual transfer using EcoCash or Algérie Poste.",
  path: "/payment",
});

export const runtime = "nodejs";

type PaymentRow = {
  label: string;
  value: string;
  mono?: boolean;
};

type PaymentMethod = {
  name: string;
  subtitle: string;
  Icon: LucideIcon;
  rows: PaymentRow[];
};

const paymentMethods: PaymentMethod[] = [
  {
    name: "EcoCash",
    subtitle: "Econet · Zimbabwe",
    Icon: Smartphone,
    rows: [{ label: "EcoCash number", value: "+263785632943", mono: true }],
  },
  {
    name: "Poste",
    subtitle: "Algérie Poste · CCP",
    Icon: Mailbox,
    rows: [
      { label: "Account holder", value: "M. MUNEMO JOSEPH SIBANGAN" },
      { label: "CCP account no.", value: "0044646657", mono: true },
      { label: "Clé (key)", value: "66", mono: true },
      { label: "Address", value: "CUB 3 BEZ, BEZ, 16042 BAB EZZOUAR 5 JUILLET" },
    ],
  },
];

export default function PaymentPage() {
  return (
    <main className="payment-page">
      <header className="payment-page-header">
        <a className="toplink" href="/">
          Back home
        </a>
        <h1>Payment</h1>
        <p>
          Send your payment using one of the methods below, then keep your
          transfer reference so we can confirm it.
        </p>
      </header>

      <section className="payment-grid" aria-label="Payment methods">
        {paymentMethods.map((method) => (
          <article className="payment-card" key={method.name}>
            <div className="payment-card-header">
              <method.Icon aria-hidden="true" />
              <div>
                <h2>{method.name}</h2>
                <p>{method.subtitle}</p>
              </div>
            </div>

            <dl className="payment-details">
              {method.rows.map((row) => (
                <div className="payment-detail" key={row.label}>
                  <dt>{row.label}</dt>
                  <dd className={row.mono ? "is-mono" : undefined}>{row.value}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </section>

      <p className="payment-note">
        <ShieldCheck aria-hidden="true" />
        <span>
          Payments are made by manual transfer only — Genaie does not process
          cards or run an automated payment gateway on this page.
        </span>
      </p>
    </main>
  );
}
