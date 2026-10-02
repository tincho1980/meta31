CREATE TYPE "public"."amortization_system" AS ENUM('french', 'german', 'american');--> statement-breakpoint
CREATE TYPE "public"."card_transaction_kind" AS ENUM('purchase', 'installment', 'subscription', 'interest', 'admin_fee', 'tax', 'payment', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."category_kind" AS ENUM('income', 'expense');--> statement-breakpoint
CREATE TYPE "public"."commitment_status" AS ENUM('pending', 'partially_paid', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."country" AS ENUM('AR', 'UY');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('ARS', 'USD', 'UYU');--> statement-breakpoint
CREATE TYPE "public"."currency_pair" AS ENUM('USD_ARS', 'UYU_USD');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('card_statement', 'utility_bill', 'loan_notice', 'tax', 'condo_fee', 'payment_receipt', 'other');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('pending_review', 'unrecognized', 'confirmed', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."entry_mode" AS ENUM('manual', 'claude');--> statement-breakpoint
CREATE TYPE "public"."expense_class" AS ENUM('utility', 'tax', 'condo_fee', 'recurring', 'budget');--> statement-breakpoint
CREATE TYPE "public"."income_status" AS ENUM('expected', 'received', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."index_kind" AS ENUM('cpi', 'uva');--> statement-breakpoint
CREATE TYPE "public"."loan_kind" AS ENUM('fixed_rate', 'uva');--> statement-breakpoint
CREATE TYPE "public"."month_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('transfer', 'debit', 'cash', 'mercado_pago', 'other');--> statement-breakpoint
CREATE TABLE "card_statement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credit_card_id" uuid NOT NULL,
	"period" date NOT NULL,
	"closing_date" date NOT NULL,
	"due_date" date NOT NULL,
	"previous_balance_local" numeric(14, 2) DEFAULT '0' NOT NULL,
	"previous_balance_usd" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_local" numeric(14, 2) NOT NULL,
	"total_usd" numeric(14, 2) NOT NULL,
	"minimum_payment_local" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"entry_mode" "entry_mode" DEFAULT 'manual' NOT NULL,
	"source_document_id" uuid,
	CONSTRAINT "card_statement_credit_card_id_period_unique" UNIQUE("credit_card_id","period"),
	CONSTRAINT "card_statement_period_check" CHECK (extract(day from "card_statement"."period") = 1)
);
--> statement-breakpoint
ALTER TABLE "card_statement" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "card_transaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_statement_id" uuid NOT NULL,
	"kind" "card_transaction_kind" NOT NULL,
	"date" date,
	"description" text NOT NULL,
	"category_id" uuid,
	"currency" "currency" NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"installment_purchase_id" uuid,
	"installment_number" smallint,
	"subscription_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"entry_mode" "entry_mode" DEFAULT 'manual' NOT NULL,
	"source_document_id" uuid
);
--> statement-breakpoint
ALTER TABLE "card_transaction" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" "category_kind" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"entry_mode" "entry_mode" DEFAULT 'manual' NOT NULL,
	"source_document_id" uuid,
	CONSTRAINT "category_name_kind_unique" UNIQUE("name","kind")
);
--> statement-breakpoint
ALTER TABLE "category" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commitment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_key" text,
	"credit_card_id" uuid,
	"recurring_expense_id" uuid,
	"one_off_expense_id" uuid,
	"loan_id" uuid,
	"installment_number" smallint,
	"parent_commitment_id" uuid,
	"description" text NOT NULL,
	"category_id" uuid NOT NULL,
	"origin_period" date NOT NULL,
	"period" date NOT NULL,
	"due_date" date,
	"currency" "currency" NOT NULL,
	"estimated_amount" numeric(14, 2) NOT NULL,
	"actual_amount" numeric(14, 2),
	"surcharge" numeric(14, 2) DEFAULT '0' NOT NULL,
	"status" "commitment_status" DEFAULT 'pending' NOT NULL,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"entry_mode" "entry_mode" DEFAULT 'manual' NOT NULL,
	"source_document_id" uuid,
	CONSTRAINT "commitment_source_key_unique" UNIQUE("source_key"),
	CONSTRAINT "commitment_period_check" CHECK (extract(day from "commitment"."period") = 1),
	CONSTRAINT "commitment_origin_period_check" CHECK (extract(day from "commitment"."origin_period") = 1),
	CONSTRAINT "commitment_single_origin_check" CHECK (num_nonnulls("commitment"."credit_card_id", "commitment"."recurring_expense_id", "commitment"."one_off_expense_id", "commitment"."loan_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "commitment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commitment_payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commitment_id" uuid NOT NULL,
	"date" date NOT NULL,
	"payment_currency" "currency" NOT NULL,
	"amount_paid" numeric(14, 2) NOT NULL,
	"applied_rate" numeric(14, 6),
	"allocated_amount" numeric(14, 2) NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"entry_mode" "entry_mode" DEFAULT 'manual' NOT NULL,
	"source_document_id" uuid
);
--> statement-breakpoint
ALTER TABLE "commitment_payment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "credit_card" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"bank" text NOT NULL,
	"country" "country" NOT NULL,
	"holder_id" uuid NOT NULL,
	"local_currency" "currency" NOT NULL,
	"closing_day" smallint NOT NULL,
	"due_day" smallint NOT NULL,
	"estimated_spend_local" numeric(14, 2) DEFAULT '0' NOT NULL,
	"estimated_spend_usd" numeric(14, 2) DEFAULT '0' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"entry_mode" "entry_mode" DEFAULT 'manual' NOT NULL,
	"source_document_id" uuid,
	CONSTRAINT "credit_card_local_currency_check" CHECK ("credit_card"."local_currency" in ('ARS', 'UYU')),
	CONSTRAINT "credit_card_closing_day_check" CHECK ("credit_card"."closing_day" between 1 and 31),
	CONSTRAINT "credit_card_due_day_check" CHECK ("credit_card"."due_day" between 1 and 31)
);
--> statement-breakpoint
ALTER TABLE "credit_card" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "economic_index" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "index_kind" NOT NULL,
	"date" date NOT NULL,
	"value" numeric(14, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"entry_mode" "entry_mode" DEFAULT 'manual' NOT NULL,
	"source_document_id" uuid,
	CONSTRAINT "economic_index_kind_date_unique" UNIQUE("kind","date")
);
--> statement-breakpoint
ALTER TABLE "economic_index" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "exchange_rate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pair" "currency_pair" NOT NULL,
	"valid_from" date NOT NULL,
	"rate" numeric(14, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"entry_mode" "entry_mode" DEFAULT 'manual' NOT NULL,
	"source_document_id" uuid,
	CONSTRAINT "exchange_rate_pair_valid_from_unique" UNIQUE("pair","valid_from"),
	CONSTRAINT "exchange_rate_rate_check" CHECK ("exchange_rate"."rate" > 0)
);
--> statement-breakpoint
ALTER TABLE "exchange_rate" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "income" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"income_source_id" uuid,
	"source_key" text,
	"description" text NOT NULL,
	"category_id" uuid NOT NULL,
	"period" date NOT NULL,
	"expected_date" date,
	"currency" "currency" NOT NULL,
	"estimated_amount" numeric(14, 2) NOT NULL,
	"actual_amount" numeric(14, 2),
	"received_date" date,
	"applied_rate" numeric(14, 6),
	"status" "income_status" DEFAULT 'expected' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"entry_mode" "entry_mode" DEFAULT 'manual' NOT NULL,
	"source_document_id" uuid,
	CONSTRAINT "income_source_key_unique" UNIQUE("source_key"),
	CONSTRAINT "income_period_check" CHECK (extract(day from "income"."period") = 1)
);
--> statement-breakpoint
ALTER TABLE "income" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "income_source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid NOT NULL,
	"holder_id" uuid,
	"property_id" uuid,
	"currency" "currency" NOT NULL,
	"every_months" smallint DEFAULT 1 NOT NULL,
	"anchor_month" smallint DEFAULT 1 NOT NULL,
	"expected_day" smallint,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"entry_mode" "entry_mode" DEFAULT 'manual' NOT NULL,
	"source_document_id" uuid,
	CONSTRAINT "income_source_every_months_check" CHECK ("income_source"."every_months" in (1, 2, 3, 6, 12)),
	CONSTRAINT "income_source_anchor_month_check" CHECK ("income_source"."anchor_month" between 1 and 12),
	CONSTRAINT "income_source_valid_from_check" CHECK (extract(day from "income_source"."valid_from") = 1),
	CONSTRAINT "income_source_expected_day_check" CHECK ("income_source"."expected_day" between 1 and 31)
);
--> statement-breakpoint
ALTER TABLE "income_source" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "income_source_amount" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"income_source_id" uuid NOT NULL,
	"from_period" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"entry_mode" "entry_mode" DEFAULT 'manual' NOT NULL,
	"source_document_id" uuid,
	CONSTRAINT "income_source_amount_income_source_id_from_period_unique" UNIQUE("income_source_id","from_period"),
	CONSTRAINT "income_source_amount_from_period_check" CHECK (extract(day from "income_source_amount"."from_period") = 1)
);
--> statement-breakpoint
ALTER TABLE "income_source_amount" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "installment_purchase" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credit_card_id" uuid NOT NULL,
	"description" text NOT NULL,
	"category_id" uuid NOT NULL,
	"purchase_date" date NOT NULL,
	"currency" "currency" NOT NULL,
	"installment_amount" numeric(14, 2) NOT NULL,
	"installments_total" smallint NOT NULL,
	"first_period" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"entry_mode" "entry_mode" DEFAULT 'manual' NOT NULL,
	"source_document_id" uuid,
	CONSTRAINT "installment_purchase_first_period_check" CHECK (extract(day from "installment_purchase"."first_period") = 1),
	CONSTRAINT "installment_purchase_installments_total_check" CHECK ("installment_purchase"."installments_total" >= 1)
);
--> statement-breakpoint
ALTER TABLE "installment_purchase" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "loan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lender" text NOT NULL,
	"holder_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"currency" "currency" NOT NULL,
	"kind" "loan_kind" NOT NULL,
	"amortization_system" "amortization_system" NOT NULL,
	"principal" numeric(14, 2) NOT NULL,
	"principal_uva" numeric(14, 6),
	"nominal_annual_rate" numeric(9, 6) NOT NULL,
	"effective_annual_rate" numeric(9, 6),
	"total_financial_cost" numeric(9, 6),
	"interest_vat_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"monthly_insurance" numeric(14, 2) DEFAULT '0' NOT NULL,
	"granted_date" date NOT NULL,
	"installments_total" smallint NOT NULL,
	"first_period" date NOT NULL,
	"due_day" smallint NOT NULL,
	"quoted_installment" numeric(14, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"entry_mode" "entry_mode" DEFAULT 'manual' NOT NULL,
	"source_document_id" uuid,
	CONSTRAINT "loan_first_period_check" CHECK (extract(day from "loan"."first_period") = 1),
	CONSTRAINT "loan_installments_total_check" CHECK ("loan"."installments_total" >= 1),
	CONSTRAINT "loan_due_day_check" CHECK ("loan"."due_day" between 1 and 31),
	CONSTRAINT "loan_principal_uva_check" CHECK (("loan"."kind" = 'uva') = ("loan"."principal_uva" is not null))
);
--> statement-breakpoint
ALTER TABLE "loan" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "month" (
	"period" date PRIMARY KEY NOT NULL,
	"status" "month_status" DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_by" uuid,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"entry_mode" "entry_mode" DEFAULT 'manual' NOT NULL,
	"source_document_id" uuid,
	CONSTRAINT "month_period_check" CHECK (extract(day from "month"."period") = 1)
);
--> statement-breakpoint
ALTER TABLE "month" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "one_off_expense" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"description" text NOT NULL,
	"category_id" uuid NOT NULL,
	"property_id" uuid,
	"currency" "currency" NOT NULL,
	"total_amount" numeric(14, 2) NOT NULL,
	"installments" smallint DEFAULT 1 NOT NULL,
	"first_period" date NOT NULL,
	"planned_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"entry_mode" "entry_mode" DEFAULT 'manual' NOT NULL,
	"source_document_id" uuid,
	CONSTRAINT "one_off_expense_first_period_check" CHECK (extract(day from "one_off_expense"."first_period") = 1),
	CONSTRAINT "one_off_expense_installments_check" CHECK ("one_off_expense"."installments" >= 1)
);
--> statement-breakpoint
ALTER TABLE "one_off_expense" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "person" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"is_user" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"entry_mode" "entry_mode" DEFAULT 'manual' NOT NULL,
	"source_document_id" uuid,
	CONSTRAINT "person_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "person" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "property" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"country" "country" NOT NULL,
	"currency" "currency" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"entry_mode" "entry_mode" DEFAULT 'manual' NOT NULL,
	"source_document_id" uuid
);
--> statement-breakpoint
ALTER TABLE "property" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recurring_expense" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"class" "expense_class" NOT NULL,
	"provider" text,
	"category_id" uuid NOT NULL,
	"property_id" uuid,
	"beneficiary_id" uuid,
	"currency" "currency" NOT NULL,
	"every_months" smallint DEFAULT 1 NOT NULL,
	"anchor_month" smallint DEFAULT 1 NOT NULL,
	"due_day" smallint,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"entry_mode" "entry_mode" DEFAULT 'manual' NOT NULL,
	"source_document_id" uuid,
	CONSTRAINT "recurring_expense_every_months_check" CHECK ("recurring_expense"."every_months" in (1, 2, 3, 6, 12)),
	CONSTRAINT "recurring_expense_anchor_month_check" CHECK ("recurring_expense"."anchor_month" between 1 and 12),
	CONSTRAINT "recurring_expense_due_day_check" CHECK ("recurring_expense"."due_day" between 1 and 31)
);
--> statement-breakpoint
ALTER TABLE "recurring_expense" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recurring_expense_amount" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recurring_expense_id" uuid NOT NULL,
	"from_period" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"entry_mode" "entry_mode" DEFAULT 'manual' NOT NULL,
	"source_document_id" uuid,
	CONSTRAINT "recurring_expense_amount_recurring_expense_id_from_period_unique" UNIQUE("recurring_expense_id","from_period"),
	CONSTRAINT "recurring_expense_amount_from_period_check" CHECK (extract(day from "recurring_expense_amount"."from_period") = 1)
);
--> statement-breakpoint
ALTER TABLE "recurring_expense_amount" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "source_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_name" text NOT NULL,
	"file_hash" text NOT NULL,
	"kind" "document_kind" NOT NULL,
	"operation" text,
	"payload" jsonb,
	"status" "document_status" DEFAULT 'pending_review' NOT NULL,
	"reason" text,
	"uploaded_by" uuid NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_document_file_hash_unique" UNIQUE("file_hash")
);
--> statement-breakpoint
ALTER TABLE "source_document" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credit_card_id" uuid NOT NULL,
	"description" text NOT NULL,
	"category_id" uuid NOT NULL,
	"currency" "currency" NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"entry_mode" "entry_mode" DEFAULT 'manual' NOT NULL,
	"source_document_id" uuid
);
--> statement-breakpoint
ALTER TABLE "subscription" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "card_statement" ADD CONSTRAINT "card_statement_credit_card_id_credit_card_id_fk" FOREIGN KEY ("credit_card_id") REFERENCES "public"."credit_card"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_statement" ADD CONSTRAINT "card_statement_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_statement" ADD CONSTRAINT "card_statement_updated_by_person_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_statement" ADD CONSTRAINT "card_statement_source_document_id_source_document_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_transaction" ADD CONSTRAINT "card_transaction_card_statement_id_card_statement_id_fk" FOREIGN KEY ("card_statement_id") REFERENCES "public"."card_statement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_transaction" ADD CONSTRAINT "card_transaction_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_transaction" ADD CONSTRAINT "card_transaction_installment_purchase_id_installment_purchase_id_fk" FOREIGN KEY ("installment_purchase_id") REFERENCES "public"."installment_purchase"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_transaction" ADD CONSTRAINT "card_transaction_subscription_id_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscription"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_transaction" ADD CONSTRAINT "card_transaction_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_transaction" ADD CONSTRAINT "card_transaction_updated_by_person_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_transaction" ADD CONSTRAINT "card_transaction_source_document_id_source_document_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_updated_by_person_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_source_document_id_source_document_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitment" ADD CONSTRAINT "commitment_credit_card_id_credit_card_id_fk" FOREIGN KEY ("credit_card_id") REFERENCES "public"."credit_card"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitment" ADD CONSTRAINT "commitment_recurring_expense_id_recurring_expense_id_fk" FOREIGN KEY ("recurring_expense_id") REFERENCES "public"."recurring_expense"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitment" ADD CONSTRAINT "commitment_one_off_expense_id_one_off_expense_id_fk" FOREIGN KEY ("one_off_expense_id") REFERENCES "public"."one_off_expense"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitment" ADD CONSTRAINT "commitment_loan_id_loan_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loan"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitment" ADD CONSTRAINT "commitment_parent_commitment_id_commitment_id_fk" FOREIGN KEY ("parent_commitment_id") REFERENCES "public"."commitment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitment" ADD CONSTRAINT "commitment_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitment" ADD CONSTRAINT "commitment_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitment" ADD CONSTRAINT "commitment_updated_by_person_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitment" ADD CONSTRAINT "commitment_source_document_id_source_document_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitment_payment" ADD CONSTRAINT "commitment_payment_commitment_id_commitment_id_fk" FOREIGN KEY ("commitment_id") REFERENCES "public"."commitment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitment_payment" ADD CONSTRAINT "commitment_payment_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitment_payment" ADD CONSTRAINT "commitment_payment_updated_by_person_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitment_payment" ADD CONSTRAINT "commitment_payment_source_document_id_source_document_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_card" ADD CONSTRAINT "credit_card_holder_id_person_id_fk" FOREIGN KEY ("holder_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_card" ADD CONSTRAINT "credit_card_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_card" ADD CONSTRAINT "credit_card_updated_by_person_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_card" ADD CONSTRAINT "credit_card_source_document_id_source_document_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "economic_index" ADD CONSTRAINT "economic_index_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "economic_index" ADD CONSTRAINT "economic_index_updated_by_person_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "economic_index" ADD CONSTRAINT "economic_index_source_document_id_source_document_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rate" ADD CONSTRAINT "exchange_rate_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rate" ADD CONSTRAINT "exchange_rate_updated_by_person_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rate" ADD CONSTRAINT "exchange_rate_source_document_id_source_document_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income" ADD CONSTRAINT "income_income_source_id_income_source_id_fk" FOREIGN KEY ("income_source_id") REFERENCES "public"."income_source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income" ADD CONSTRAINT "income_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income" ADD CONSTRAINT "income_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income" ADD CONSTRAINT "income_updated_by_person_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income" ADD CONSTRAINT "income_source_document_id_source_document_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_source" ADD CONSTRAINT "income_source_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_source" ADD CONSTRAINT "income_source_holder_id_person_id_fk" FOREIGN KEY ("holder_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_source" ADD CONSTRAINT "income_source_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_source" ADD CONSTRAINT "income_source_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_source" ADD CONSTRAINT "income_source_updated_by_person_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_source" ADD CONSTRAINT "income_source_source_document_id_source_document_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_source_amount" ADD CONSTRAINT "income_source_amount_income_source_id_income_source_id_fk" FOREIGN KEY ("income_source_id") REFERENCES "public"."income_source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_source_amount" ADD CONSTRAINT "income_source_amount_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_source_amount" ADD CONSTRAINT "income_source_amount_updated_by_person_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_source_amount" ADD CONSTRAINT "income_source_amount_source_document_id_source_document_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_purchase" ADD CONSTRAINT "installment_purchase_credit_card_id_credit_card_id_fk" FOREIGN KEY ("credit_card_id") REFERENCES "public"."credit_card"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_purchase" ADD CONSTRAINT "installment_purchase_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_purchase" ADD CONSTRAINT "installment_purchase_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_purchase" ADD CONSTRAINT "installment_purchase_updated_by_person_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_purchase" ADD CONSTRAINT "installment_purchase_source_document_id_source_document_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_holder_id_person_id_fk" FOREIGN KEY ("holder_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_updated_by_person_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_source_document_id_source_document_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month" ADD CONSTRAINT "month_opened_by_person_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month" ADD CONSTRAINT "month_closed_by_person_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month" ADD CONSTRAINT "month_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month" ADD CONSTRAINT "month_updated_by_person_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month" ADD CONSTRAINT "month_source_document_id_source_document_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_off_expense" ADD CONSTRAINT "one_off_expense_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_off_expense" ADD CONSTRAINT "one_off_expense_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_off_expense" ADD CONSTRAINT "one_off_expense_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_off_expense" ADD CONSTRAINT "one_off_expense_updated_by_person_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_off_expense" ADD CONSTRAINT "one_off_expense_source_document_id_source_document_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_updated_by_person_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_source_document_id_source_document_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_updated_by_person_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_source_document_id_source_document_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expense" ADD CONSTRAINT "recurring_expense_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expense" ADD CONSTRAINT "recurring_expense_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expense" ADD CONSTRAINT "recurring_expense_beneficiary_id_person_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expense" ADD CONSTRAINT "recurring_expense_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expense" ADD CONSTRAINT "recurring_expense_updated_by_person_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expense" ADD CONSTRAINT "recurring_expense_source_document_id_source_document_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expense_amount" ADD CONSTRAINT "recurring_expense_amount_recurring_expense_id_recurring_expense_id_fk" FOREIGN KEY ("recurring_expense_id") REFERENCES "public"."recurring_expense"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expense_amount" ADD CONSTRAINT "recurring_expense_amount_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expense_amount" ADD CONSTRAINT "recurring_expense_amount_updated_by_person_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expense_amount" ADD CONSTRAINT "recurring_expense_amount_source_document_id_source_document_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_document" ADD CONSTRAINT "source_document_uploaded_by_person_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_document" ADD CONSTRAINT "source_document_reviewed_by_person_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_credit_card_id_credit_card_id_fk" FOREIGN KEY ("credit_card_id") REFERENCES "public"."credit_card"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_updated_by_person_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_source_document_id_source_document_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_transaction_card_statement_idx" ON "card_transaction" USING btree ("card_statement_id");--> statement-breakpoint
CREATE INDEX "commitment_period_status_idx" ON "commitment" USING btree ("period","status");--> statement-breakpoint
CREATE INDEX "commitment_origin_period_idx" ON "commitment" USING btree ("origin_period");--> statement-breakpoint
CREATE INDEX "commitment_payment_commitment_idx" ON "commitment_payment" USING btree ("commitment_id");--> statement-breakpoint
CREATE INDEX "income_period_status_idx" ON "income" USING btree ("period","status");--> statement-breakpoint
CREATE INDEX "subscription_credit_card_idx" ON "subscription" USING btree ("credit_card_id");