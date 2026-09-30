package httpapi

import (
	"noor/internal/catalog"
	"noor/internal/xmlparse"
)

// metaAdapter اتصال catalog به موتور جست‌وجو (MetaSource).
type metaAdapter struct{ c *catalog.Service }

func (m metaAdapter) WorkTitle(uid string) (string, string, string, bool) {
	w, ok := m.c.Work(uid)
	if !ok {
		return "", "", "", false
	}
	return w.Title, w.ShortTitle, w.Author, true
}

func (m metaAdapter) DocumentMeta(uid string) (string, string, bool) {
	for _, w := range m.c.Works() {
		for _, d := range w.Documents {
			if d.UID == uid {
				return w.UID, d.Label, true
			}
		}
	}
	return "", "", false
}

func (m metaAdapter) SectionTitle(docUID, secUID string) (string, bool) {
	mm, err := m.c.Model(docUID)
	if err != nil {
		return "", false
	}
	var find func(secs []*xmlparse.SectionRec) (string, bool)
	find = func(secs []*xmlparse.SectionRec) (string, bool) {
		for _, sc := range secs {
			if sc.UID == secUID {
				return sc.Title, true
			}
			if t, ok := find(sc.Children); ok {
				return t, true
			}
		}
		return "", false
	}
	return find(mm.Sections)
}

// MetaAdapter سازندهٔ آداپتور متادیتا برای main.
func MetaAdapter(c *catalog.Service) metaAdapter { return metaAdapter{c: c} }
