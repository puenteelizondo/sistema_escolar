import calendar
import os
from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

TZ = ZoneInfo(os.getenv("TZ", "America/Mexico_City"))

MESES_ABR = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"]
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
         "septiembre", "octubre", "noviembre", "diciembre"]


def ahora() -> datetime:
    return datetime.now(TZ)


def hoy() -> date:
    return ahora().date()


def add_months(d: date, n: int) -> date:
    y, m = divmod(d.month - 1 + n, 12)
    y += d.year
    m += 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def fecha_ticket(d: date) -> str:
    return f"{d.day:02d} {MESES_ABR[d.month - 1]} {d.year}"


def fecha_corta(d) -> str:
    return d.strftime("%d/%m/%Y") if d else ""


def num_ticket(n: int) -> str:
    return f"{n:04d}"


def money(x) -> float:
    return float(Decimal(x or 0).quantize(Decimal("0.01")))


def fmt_money(x) -> str:
    v = Decimal(x or 0)
    if v == v.to_integral():
        return f"${v:,.0f}"
    return f"${v:,.2f}"


def dt_local(dt: datetime | None) -> str | None:
    if not dt:
        return None
    return dt.astimezone(TZ).isoformat()
