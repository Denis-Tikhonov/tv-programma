#!/usr/bin/env python3
"""Merge XMLTV: priority base (1lot), add unique channels from extra (gabbarit). Filter by days."""
from __future__ import annotations

import gzip
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Max merged.gz size before falling back to fewer days (bytes)
MAX_GZ_BYTES = 35 * 1024 * 1024


def parse_xmltv_time(s: str) -> datetime | None:
    if not s or len(s) < 14:
        return None
    try:
        dt = datetime(
            int(s[0:4]), int(s[4:6]), int(s[6:8]),
            int(s[8:10]), int(s[10:12]), int(s[12:14]),
            tzinfo=timezone.utc,
        )
        if len(s) > 15 and (s[14] == '+' or s[14] == '-' or s[15] in '+-'):
            # offset present — treat as local wall already encoded; keep as naive-ish UTC for filter
            pass
        return dt
    except Exception:
        return None


def day_range(days: int) -> tuple[datetime, datetime]:
    """Match app: 3 = -1..+2, 7 = -2..+5 from start of today UTC."""
    now = datetime.now(timezone.utc)
    start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
    if days <= 1:
        return start, start + timedelta(days=1)
    if days <= 3:
        return start - timedelta(days=1), start + timedelta(days=2)
    return start - timedelta(days=2), start + timedelta(days=5)


def load_filtered(path: Path, range_start: datetime, range_end: datetime, only_channel_ids: set[str] | None):
    """
    Returns (channels dict id -> element clone-ish data, programmes list of elements data).
    If only_channel_ids is a set, only programmes for those ids (and only those channels).
    If only_channel_ids is None, take all channels; programmes in range for any channel.
    """
    channels: dict[str, dict] = {}
    programmes: list[dict] = []

    opener = gzip.open if str(path).endswith('.gz') else open
    with opener(path, 'rb') as f:
        # ElementTree needs file-like text or bytes — use binary with iterparse
        context = ET.iterparse(f, events=('end',))
        for event, elem in context:
            tag = elem.tag
            if tag == 'channel':
                cid = elem.get('id')
                if not cid:
                    elem.clear()
                    continue
                if only_channel_ids is not None and cid not in only_channel_ids:
                    elem.clear()
                    continue
                names = [n.text or '' for n in elem.findall('display-name')]
                icon = None
                ic = elem.find('icon')
                if ic is not None:
                    icon = ic.get('src')
                channels[cid] = {'id': cid, 'names': names, 'icon': icon}
                elem.clear()
            elif tag == 'programme':
                cid = elem.get('channel')
                start_s = elem.get('start')
                if not cid or not start_s:
                    elem.clear()
                    continue
                if only_channel_ids is not None and cid not in only_channel_ids:
                    elem.clear()
                    continue
                st = parse_xmltv_time(start_s)
                if st is None or st < range_start or st >= range_end:
                    elem.clear()
                    continue
                stop_s = elem.get('stop')
                title_el = elem.find('title')
                desc_el = elem.find('desc')
                cat_el = elem.find('category')
                programmes.append({
                    'channel': cid,
                    'start': start_s,
                    'stop': stop_s,
                    'title': title_el.text if title_el is not None else '',
                    'desc': desc_el.text if desc_el is not None else '',
                    'category': cat_el.text if cat_el is not None else '',
                })
                elem.clear()
            elif tag == 'tv':
                elem.clear()
    return channels, programmes


def load_base(path: Path, range_start: datetime, range_end: datetime):
    return load_filtered(path, range_start, range_end, only_channel_ids=None)


def load_extra_new_channels(path: Path, range_start: datetime, range_end: datetime, existing_ids: set[str]):
    """Load channels not in existing_ids and programmes only for those new ids."""
    # First collect all channel ids from extra that are new — need two-phase or one pass
    channels: dict[str, dict] = {}
    programmes: list[dict] = []
    opener = gzip.open if str(path).endswith('.gz') else open
    with opener(path, 'rb') as f:
        context = ET.iterparse(f, events=('end',))
        for event, elem in context:
            tag = elem.tag
            if tag == 'channel':
                cid = elem.get('id')
                if not cid or cid in existing_ids:
                    elem.clear()
                    continue
                names = [n.text or '' for n in elem.findall('display-name')]
                icon = None
                ic = elem.find('icon')
                if ic is not None:
                    icon = ic.get('src')
                channels[cid] = {'id': cid, 'names': names, 'icon': icon}
                elem.clear()
            elif tag == 'programme':
                cid = elem.get('channel')
                start_s = elem.get('start')
                if not cid or cid in existing_ids or not start_s:
                    elem.clear()
                    continue
                st = parse_xmltv_time(start_s)
                if st is None or st < range_start or st >= range_end:
                    elem.clear()
                    continue
                # only keep if channel will be new — may appear before channel el; keep if not existing
                stop_s = elem.get('stop')
                title_el = elem.find('title')
                desc_el = elem.find('desc')
                cat_el = elem.find('category')
                programmes.append({
                    'channel': cid,
                    'start': start_s,
                    'stop': stop_s,
                    'title': title_el.text if title_el is not None else '',
                    'desc': desc_el.text if desc_el is not None else '',
                    'category': cat_el.text if cat_el is not None else '',
                })
                elem.clear()
            elif tag == 'tv':
                elem.clear()
    # drop programmes whose channel wasn't actually added
    new_ids = set(channels.keys())
    programmes = [p for p in programmes if p['channel'] in new_ids]
    return channels, programmes


def write_xmltv(path_gz: Path, channels: dict, programmes: list) -> None:
    root = ET.Element('tv', generator_info_name='tv-programma-merge')
    for cid, ch in channels.items():
        cel = ET.SubElement(root, 'channel', id=cid)
        for n in ch['names'] or [cid]:
            dn = ET.SubElement(cel, 'display-name')
            dn.text = n
        if ch.get('icon'):
            ET.SubElement(cel, 'icon', src=ch['icon'])
    for p in programmes:
        attrs = {'start': p['start'], 'channel': p['channel']}
        if p.get('stop'):
            attrs['stop'] = p['stop']
        pel = ET.SubElement(root, 'programme', attrs)
        t = ET.SubElement(pel, 'title')
        t.text = p.get('title') or ''
        if p.get('desc'):
            d = ET.SubElement(pel, 'desc')
            d.text = p['desc']
        if p.get('category'):
            c = ET.SubElement(pel, 'category')
            c.text = p['category']
    tree = ET.ElementTree(root)
    tmp = path_gz.with_suffix('.xml')
    tree.write(tmp, encoding='utf-8', xml_declaration=True)
    with open(tmp, 'rb') as fin, gzip.open(path_gz, 'wb', compresslevel=6) as fout:
        while True:
            chunk = fin.read(1024 * 1024)
            if not chunk:
                break
            fout.write(chunk)
    tmp.unlink(missing_ok=True)


def merge(base_gz: Path, extra_gz: Path, out_gz: Path, days: int) -> dict:
    range_start, range_end = day_range(days)
    print(f"Range days={days}: {range_start.isoformat()} .. {range_end.isoformat()}")

    print(f"Loading base {base_gz} ...")
    ch_base, pr_base = load_base(base_gz, range_start, range_end)
    print(f"  base channels={len(ch_base)} programmes={len(pr_base)}")

    existing = set(ch_base.keys())
    print(f"Loading extra {extra_gz} (new channels only) ...")
    ch_extra, pr_extra = load_extra_new_channels(extra_gz, range_start, range_end, existing)
    print(f"  extra new channels={len(ch_extra)} programmes={len(pr_extra)}")

    channels = {**ch_base, **ch_extra}
    programmes = pr_base + pr_extra
    write_xmltv(out_gz, channels, programmes)
    size = out_gz.stat().st_size
    print(f"Wrote {out_gz} ({size / 1e6:.1f} MB) channels={len(channels)} programmes={len(programmes)}")
    return {
        'channels': len(channels),
        'programmes': len(programmes),
        'size': size,
        'days': days,
    }


def main():
    base = Path(sys.argv[1] if len(sys.argv) > 1 else 'epg/1lot.xml.gz')
    extra = Path(sys.argv[2] if len(sys.argv) > 2 else 'epg/gabbarit.xml.gz')
    out = Path(sys.argv[3] if len(sys.argv) > 3 else 'epg/merged.xml.gz')

    if not base.exists():
        print(f"Missing base: {base}", file=sys.stderr)
        sys.exit(1)
    if not extra.exists():
        print(f"Missing extra: {extra}", file=sys.stderr)
        sys.exit(1)

    stats = merge(base, extra, out, days=7)
    if stats['size'] > MAX_GZ_BYTES:
        print(f"Size {stats['size']/1e6:.1f} MB > {MAX_GZ_BYTES/1e6:.0f} MB — retry with 3 days")
        stats = merge(base, extra, out, days=3)

    meta = out.with_suffix('.meta.txt')
    meta.write_text(
        f"days={stats['days']}\nchannels={stats['channels']}\n"
        f"programmes={stats['programmes']}\nsize_bytes={stats['size']}\n",
        encoding='utf-8',
    )
    print('Done.')


if __name__ == '__main__':
    main()
