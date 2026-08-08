# n1_custom

Organization A's customization layer for the N1 HR/payroll backend
(our fork of upstream Frappe HR — `vendor/n1`). It installs **on top of**
`frappe` + `hrms` so the upstream submodule stays clean and pull-able.

## Why a custom app (not editing hrms directly)

Frappe customizations (custom fields, DocType overrides, fixtures, server
scripts) belong in a separate app. This keeps `vendor/n1` free of local diffs,
so upstream payroll/compliance updates can be pulled without merge conflicts.

## What lives here

- `n1_custom/hooks.py` — app hooks; declares the fixtures to sync.
- `n1_custom/fixtures/custom_field.json` — custom fields added to standard
  DocTypes. Starter set on `Employee`: `orga_team`, `orga_role` (the fields our
  spine keys on for team/role). Extend this as needs crystallize.

## Install (requires a running Frappe env — Docker/GCP, deferred)

```bash
# from the bench root (frappe + hrms already installed)
bench get-app /path/to/apps/n1-custom
bench --site <site> install-app n1_custom
bench --site <site> migrate          # creates the custom fields
```

> ⚠️ This is **config-only**. It cannot be run or tested here — there is no
> Frappe environment (Python/`bench`) in this workspace yet. Validation waits
> for the Docker/GCP environment (Phase 0 GCP).
