// fixturegen تولید مجموعهٔ آزمون هم‌ساخت نور + کاتالوگ.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"noor/internal/fixturegen"
)

func main() {
	dir := flag.String("dir", "./data/sources", "مسیر منابع")
	flag.Parse()
	works, err := fixturegen.Generate(*dir)
	if err != nil {
		fmt.Fprintln(os.Stderr, "خطا:", err)
		os.Exit(1)
	}
	out, _ := json.MarshalIndent(works, "", "  ")
	if err := os.WriteFile(*dir+"/catalog.json", out, 0o644); err != nil {
		fmt.Fprintln(os.Stderr, "خطای کاتالوگ:", err)
		os.Exit(1)
	}
	fmt.Printf("✔ %d اثر تولید شد در %s\n", len(works), *dir)
}
