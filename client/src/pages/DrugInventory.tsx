import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Pill, Loader2, AlertTriangle, Lock, History } from "lucide-react";
import { isDrugExpired, isDrugExpiringSoon } from "@shared/inventory";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import { EmptyState } from "@/components/EmptyState";

function DrugInventoryLockedScreen() {
  const [, navigate] = useLocation();
  const checkoutMutation = trpc.clinic.getCheckoutUrl.useMutation({
    onSuccess: (data) => { window.location.href = data.url; },
    onError: (e) => toast.error(e.message),
  });
  return (
    <DashboardLayout>
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <div className="bg-blue-50 rounded-full p-4 mb-4">
          <Lock className="w-10 h-10 text-blue-500" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Medicines</h2>
        <p className="text-gray-500 mb-1 max-w-sm">
          Track stock levels, manage restocking, and automatically deduct drugs during patient visits.
        </p>
        <p className="text-sm text-blue-600 font-medium mb-6">Available on the Clinic plan — UGX 90,000/month</p>
        <div className="flex gap-3">
          <Button
            className="bg-blue-600 hover:bg-blue-700"
            disabled={checkoutMutation.isPending}
            onClick={() => checkoutMutation.mutate({ plan: "clinic" })}
          >
            {checkoutMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Upgrade to Clinic
          </Button>
          <Button variant="outline" onClick={() => navigate("/settings")}>
            View plans
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}

export default function DrugInventory() {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [restockDrug, setRestockDrug] = useState<any>(null);
  const [historyDrug, setHistoryDrug] = useState<any>(null);
  const [restockQty, setRestockQty] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [form, setForm] = useState({ drugName: "", genericName: "", quantity: 0, unit: "tablets", costPerUnit: 0, sellingPrice: 0, lowStockThreshold: 10, supplier: "", expiryDate: "" });

  const { data: tierStatus } = trpc.clinic.getTierStatus.useQuery();
  const drugInventoryEnabled = tierStatus?.limits?.drugInventory ?? true; // optimistic while loading

  const { data: drugs, isLoading, refetch } = trpc.drug.list.useQuery(undefined, {
    enabled: drugInventoryEnabled,
  });
  const canManage = user?.role === "manager" || user?.role === "admin";

  const createMutation = trpc.drug.create.useMutation({
    onSuccess: () => { toast.success("Drug added to inventory"); setIsOpen(false); setForm({ drugName: "", genericName: "", quantity: 0, unit: "tablets", costPerUnit: 0, sellingPrice: 0, lowStockThreshold: 10, supplier: "", expiryDate: "" }); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const restockMutation = trpc.drug.restock.useMutation({
    onSuccess: () => { toast.success("Stock updated"); setRestockDrug(null); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.drug.delete.useMutation({
    onSuccess: () => { toast.success("Drug removed"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const filteredDrugs = useMemo(() => drugs?.filter((d: any) =>
    d.drugName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (d.genericName || "").toLowerCase().includes(searchTerm.toLowerCase())
  ) || [], [drugs, searchTerm]);

  const lowStockCount = drugs?.filter((d: any) => d.quantity <= d.lowStockThreshold && d.quantity > 0).length || 0;
  const outOfStockCount = drugs?.filter((d: any) => d.quantity === 0).length || 0;
  const isExpired = (d: any) => isDrugExpired(d.expiryDate);
  const isExpiringSoon = (d: any) => isDrugExpiringSoon(d.expiryDate);
  const expiredCount = drugs?.filter(isExpired).length || 0;
  const expiringSoonCount = drugs?.filter(isExpiringSoon).length || 0;

  // Show locked screen for free tier once tierStatus has loaded
  if (tierStatus && !drugInventoryEnabled) {
    return <DrugInventoryLockedScreen />;
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Medicines</h1>
            <p className="text-gray-600 mt-1">Track stock, expiry dates, and low-stock alerts</p>
          </div>
          {canManage && (
            <Dialog open={isOpen} onOpenChange={setIsOpen}>
              <DialogTrigger asChild>
                <Button className="bg-green-600 hover:bg-green-700"><Plus className="w-4 h-4 mr-2" />Add Drug</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Add Drug to Inventory</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div><label className="text-sm font-medium">Drug Name *</label><Input value={form.drugName} onChange={(e) => setForm({ ...form, drugName: e.target.value })} /></div>
                    <div><label className="text-sm font-medium">Generic Name</label><Input value={form.genericName} onChange={(e) => setForm({ ...form, genericName: e.target.value })} /></div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div><label className="text-sm font-medium">Quantity</label><Input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: parseInt(e.target.value) || 0 })} /></div>
                    <div><label className="text-sm font-medium">Unit</label>
                      <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                        <option>tablets</option><option>capsules</option><option>ml</option><option>mg</option><option>vials</option><option>sachets</option>
                      </select>
                    </div>
                    <div><label className="text-sm font-medium">Low Stock Alert</label><Input type="number" value={form.lowStockThreshold} onChange={(e) => setForm({ ...form, lowStockThreshold: parseInt(e.target.value) || 0 })} /></div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div><label className="text-sm font-medium">Cost Price (UGX)</label><Input type="number" value={form.costPerUnit} onChange={(e) => setForm({ ...form, costPerUnit: parseFloat(e.target.value) || 0 })} /></div>
                    <div><label className="text-sm font-medium">Selling Price (UGX)</label><Input type="number" value={form.sellingPrice} onChange={(e) => setForm({ ...form, sellingPrice: parseFloat(e.target.value) || 0 })} /></div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div><label className="text-sm font-medium">Supplier</label><Input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} /></div>
                    <div><label className="text-sm font-medium">Expiry Date</label><Input type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} /></div>
                  </div>
                  <Button className="w-full bg-green-600 hover:bg-green-700" disabled={createMutation.isPending || !form.drugName}
                    onClick={() => createMutation.mutate(form)}>
                    {createMutation.isPending ? "Adding..." : "Add Drug"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card><CardContent className="pt-6"><p className="text-sm text-gray-500">Total Drugs</p><p className="text-2xl font-bold">{drugs?.length || 0}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-sm text-gray-500 flex items-center gap-1"><AlertTriangle className="w-4 h-4 text-yellow-500" />Low Stock</p><p className="text-2xl font-bold text-yellow-600">{lowStockCount}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-sm text-gray-500 flex items-center gap-1"><AlertTriangle className="w-4 h-4 text-red-500" />Out of Stock</p><p className="text-2xl font-bold text-red-600">{outOfStockCount}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-sm text-gray-500 flex items-center gap-1"><AlertTriangle className="w-4 h-4 text-orange-500" />Expiring ≤30d</p><p className="text-2xl font-bold text-orange-600">{expiringSoonCount}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-sm text-gray-500 flex items-center gap-1"><AlertTriangle className="w-4 h-4 text-red-700" />Expired</p><p className="text-2xl font-bold text-red-700">{expiredCount}</p></CardContent></Card>
        </div>

        {/* Search */}
        <Card><CardContent className="pt-4"><Input placeholder="Search drugs..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="max-w-xs" /></CardContent></Card>

        {/* Drug List */}
        <Card>
          <CardHeader><CardTitle>Stock ({filteredDrugs.length})</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
            ) : filteredDrugs.length === 0 ? (
              <EmptyState
                icon={Pill}
                title="No medicines in stock yet"
                description="Add your first medicine to track stock levels, expiry dates, and automatic deductions when you prescribe during a visit."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left py-3 px-4">Drug Name</th>
                      <th className="text-left py-3 px-4">Unit</th>
                      <th className="text-center py-3 px-4">Stock</th>
                      <th className="text-right py-3 px-4">Cost</th>
                      <th className="text-right py-3 px-4">Selling</th>
                      <th className="text-left py-3 px-4">Expiry</th>
                      <th className="text-left py-3 px-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredDrugs.map((drug: any) => {
                      const isLow = drug.quantity <= drug.lowStockThreshold && drug.quantity > 0;
                      const isOut = drug.quantity === 0;
                      const expired = isExpired(drug);
                      const expiringSoon = isExpiringSoon(drug);
                      return (
                        <tr key={drug.id} className={`hover:bg-gray-50 ${expired ? "bg-red-100" : isOut ? "bg-red-50" : isLow || expiringSoon ? "bg-yellow-50" : ""}`}>
                          <td className="py-3 px-4">
                            <div className="font-medium">{drug.drugName}</div>
                            {drug.genericName && <div className="text-xs text-gray-500">{drug.genericName}</div>}
                          </td>
                          <td className="py-3 px-4">{drug.unit}</td>
                          <td className="py-3 px-4 text-center">
                            <span className={`font-bold ${isOut ? "text-red-600" : isLow ? "text-yellow-600" : "text-green-700"}`}>{drug.quantity}</span>
                            {isOut && <span className="ml-1 text-xs bg-red-100 text-red-700 px-1 rounded">OUT</span>}
                            {isLow && <span className="ml-1 text-xs bg-yellow-100 text-yellow-700 px-1 rounded">LOW</span>}
                          </td>
                          <td className="py-3 px-4 text-right">UGX {Number(drug.costPerUnit).toLocaleString()}</td>
                          <td className="py-3 px-4 text-right">UGX {Number(drug.sellingPrice).toLocaleString()}</td>
                          <td className="py-3 px-4 text-sm">
                            {drug.expiryDate ? (
                              <span className={expired ? "text-red-700 font-bold" : expiringSoon ? "text-orange-600 font-medium" : "text-gray-600"}>
                                {new Date(drug.expiryDate).toLocaleDateString()}
                                {expired && <span className="ml-1 text-xs bg-red-200 text-red-800 px-1 rounded">EXPIRED</span>}
                                {expiringSoon && <span className="ml-1 text-xs bg-orange-100 text-orange-700 px-1 rounded">SOON</span>}
                              </span>
                            ) : "—"}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex gap-2">
                              <Button size="sm" variant="ghost" className="text-xs" onClick={() => setHistoryDrug(drug)}>
                                <History className="w-3 h-3 mr-1" />History
                              </Button>
                              {canManage && (
                                <>
                                  <Button size="sm" variant="outline" className="text-xs" onClick={() => { setRestockDrug(drug); setRestockQty(0); }}>Restock</Button>
                                  <Button size="sm" variant="ghost" className="text-xs text-red-600" onClick={() => { if (confirm(`Delete ${drug.drugName}?`)) deleteMutation.mutate({ drugId: drug.id }); }}>Delete</Button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Restock Dialog */}
      {restockDrug && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-sm space-y-4 shadow-xl">
            <h2 className="text-lg font-bold">Restock — {restockDrug.drugName}</h2>
            <p className="text-sm text-gray-600">Current stock: <strong>{restockDrug.quantity} {restockDrug.unit}</strong></p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Units to Add</label>
              <Input type="number" value={restockQty} onChange={(e) => setRestockQty(parseInt(e.target.value) || 0)} />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setRestockDrug(null)}>Cancel</Button>
              <Button className="flex-1 bg-green-600 hover:bg-green-700" disabled={restockMutation.isPending || restockQty <= 0}
                onClick={() => restockMutation.mutate({ drugId: restockDrug.id, quantity: restockQty })}>
                {restockMutation.isPending ? "Updating..." : "Confirm Restock"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {historyDrug && <StockHistoryModal drug={historyDrug} onClose={() => setHistoryDrug(null)} />}
    </DashboardLayout>
  );
}

function StockHistoryModal({ drug, onClose }: { drug: any; onClose: () => void }) {
  const { data: history, isLoading } = trpc.drug.stockHistory.useQuery({ drugId: drug.id });
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg p-6 w-full max-w-md space-y-4 shadow-xl max-h-[80vh] overflow-y-auto">
        <div className="flex justify-between items-start">
          <h2 className="text-lg font-bold">Stock History — {drug.drugName}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        {isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
        ) : !history || history.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">No stock movements recorded yet</p>
        ) : (
          <div className="space-y-2">
            {history.map((h: any) => (
              <div key={h.id} className="flex justify-between items-center text-sm border-b pb-2">
                <div>
                  <p className="font-medium capitalize">{h.transactionType || "Change"}</p>
                  <p className="text-xs text-gray-500">{new Date(h.createdAt).toLocaleString()}</p>
                </div>
                <div className="text-right">
                  <p className={`font-bold ${h.quantityChanged > 0 ? "text-green-600" : "text-red-600"}`}>
                    {h.quantityChanged > 0 ? "+" : ""}{h.quantityChanged}
                  </p>
                  <p className="text-xs text-gray-400">{h.previousQuantity} → {h.newQuantity}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        <Button variant="outline" className="w-full" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}
