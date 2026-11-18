import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/src/context/AuthContext';
import { useAppData } from '@/src/context/AppDataContext';
import { useTheme } from '@/src/context/ThemeContext';
import {
  Save,
  Lock,
  Store,
  Upload,
  Moon,
  Sun,
  Monitor,
  Check,
  Printer,
  Database,
  Download,
  FileUp,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  ShieldAlert,
  Layers,
} from 'lucide-react';
import { parseAndValidateBackup, type FullSystemBackup } from '@/src/utils/backup';

type SettingsTab = 'profile' | 'backup' | 'security' | 'appearance';

export default function Settings({ initialTab = 'profile' }: { initialTab?: SettingsTab }) {
  const { changePassword } = useAuth();
  const {
    inventory,
    categories,
    customers,
    suppliers,
    invoices,
    purchases,
    businessProfile,
    updateBusinessProfile,
    exportFullBackup,
    restoreFullBackup,
  } = useAppData();
  const { theme, isDarkMode, setTheme, toggleDarkMode } = useTheme();
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  // Backup & Restore state
  const [includePasswordInExport, setIncludePasswordInExport] = useState(false);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(() => {
    try {
      return localStorage.getItem('doctor_tools_last_backup_at');
    } catch {
      return null;
    }
  });
  const [exportSuccessMsg, setExportSuccessMsg] = useState<string | null>(null);
  const [isDraggingBackup, setIsDraggingBackup] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [uploadedFileSize, setUploadedFileSize] = useState<number>(0);
  const [parsedBackup, setParsedBackup] = useState<FullSystemBackup | null>(null);
  const [backupParseError, setBackupParseError] = useState<string | null>(null);
  const [restoreMode, setRestoreMode] = useState<'replace' | 'merge'>('replace');
  const [restorePasswordOpt, setRestorePasswordOpt] = useState(false);
  const [restoreThemeOpt, setRestoreThemeOpt] = useState(true);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreStatusBanner, setRestoreStatusBanner] = useState<{
    type: 'success' | 'warning' | 'error';
    title: string;
    details: string;
  } | null>(null);

  const [profile, setProfile] = useState({
    businessName: businessProfile.name,
    phone: businessProfile.phone,
    address: businessProfile.address,
    description: businessProfile.description || '',
    logo: businessProfile.logo
  });

  useEffect(() => {
    setProfile({
      businessName: businessProfile.name,
      phone: businessProfile.phone,
      address: businessProfile.address,
      description: businessProfile.description || '',
      logo: businessProfile.logo
    });
  }, [businessProfile]);

  const [security, setSecurity] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  const handleProfileSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateBusinessProfile({
      name: profile.businessName,
      phone: profile.phone,
      address: profile.address,
      description: profile.description,
      logo: profile.logo
    });
    alert('تم حفظ البيانات بنجاح!');
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setProfile(prev => ({ ...prev, logo: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSecuritySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (security.newPassword !== security.confirmPassword) {
      alert('كلمة المرور الجديدة غير متطابقة!');
      return;
    }
    const result = await changePassword(security.currentPassword, security.newPassword);
    if (!result.success) {
      alert(result.error || 'حدث خطأ أثناء تغيير كلمة المرور!');
      return;
    }
    alert('تم تغيير كلمة المرور بنجاح!');
    setSecurity({ currentPassword: '', newPassword: '', confirmPassword: '' });
  };

  const handleDownloadBackup = () => {
    setExportSuccessMsg(null);
    const backup = exportFullBackup({ includePassword: includePasswordInExport });
    const jsonString = JSON.stringify(backup, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
    const fileName = `doctor-tools-backup-${stamp}.json`;

    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setLastBackupAt(backup.exportedAt);
    setExportSuccessMsg(`تم تصدير النسخة الاحتياطية الكاملة بنجاح (${fileName}).`);
  };

  const processBackupFile = (file: File) => {
    setBackupParseError(null);
    setRestoreStatusBanner(null);
    setParsedBackup(null);
    setUploadedFileName(file.name);
    setUploadedFileSize(file.size);

    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const result = parseAndValidateBackup(text);
      if (!result.valid || !result.backup) {
        setBackupParseError(result.error || 'تعذر قراءة ملف النسخة الاحتياطية.');
        return;
      }
      setParsedBackup(result.backup);
      setRestorePasswordOpt(Boolean(result.backup.settings?.authPassword));
      setRestoreThemeOpt(Boolean(result.backup.settings?.theme));
    };
    reader.onerror = () => {
      setBackupParseError('حدث خطأ أثناء قراءة الملف من جهازك.');
    };
    reader.readAsText(file, 'utf-8');
  };

  const handleBackupFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processBackupFile(file);
    }
    e.target.value = '';
  };

  const handleBackupDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingBackup(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processBackupFile(file);
    }
  };

  const handleConfirmRestore = async () => {
    if (!parsedBackup || isRestoring) return;
    setIsRestoring(true);
    setRestoreStatusBanner(null);

    try {
      const res = await restoreFullBackup(parsedBackup, restoreMode, {
        restorePassword: restorePasswordOpt,
      });

      if (restoreThemeOpt && parsedBackup.settings?.theme) {
        setTheme(parsedBackup.settings.theme);
      }

      const countsText = `${res.counts.inventoryCount} صنف، ${res.counts.categoriesCount} فئة، ${res.counts.customersCount} عميل، ${res.counts.suppliersCount} مورد، ${res.counts.invoicesCount} فاتورة، ${res.counts.purchasesCount} عملية شراء`;

      if (res.cloudSynced) {
        setRestoreStatusBanner({
          type: 'success',
          title: 'تمت استعادة النسخة الاحتياطية ومزامنتها سحابياً بنجاح!',
          details: `البيانات المفعّلة الآن في النظام: ${countsText}.`,
        });
      } else {
        setRestoreStatusBanner({
          type: 'warning',
          title: 'تمت استعادة البيانات محلياً في النظام',
          details: `البيانات المفعّلة الآن: ${countsText}. (تنبيه: تعذر الوصول إلى السحابة حالياً${res.cloudError ? `: ${res.cloudError}` : ''}).`,
        });
      }

      setParsedBackup(null);
      setUploadedFileName('');
      setUploadedFileSize(0);
    } catch (err) {
      setRestoreStatusBanner({
        type: 'error',
        title: 'حدث خطأ غير متوقع أثناء استعادة النسخة',
        details: err instanceof Error ? err.message : 'يرجى المحاولة مرة أخرى.',
      });
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-[#1E293B]">الإعدادات</h2>
        <p className="mt-1 text-sm text-[#475569]">إدارة بيانات النظام، النسخ الاحتياطي، المظهر وحسابات المستخدمين</p>
      </div>

      <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-sm flex flex-col md:flex-row overflow-hidden">
        
        {/* Sidebar for settings tabs */}
        <div className="w-full md:w-64 bg-[#F8FAFC] border-b md:border-b-0 md:border-l border-[#E2E8F0] p-3 md:p-4 flex flex-row md:flex-col gap-2 overflow-x-auto">
          <button 
            onClick={() => setActiveTab('profile')}
            className={`flex-1 md:flex-initial md:w-full flex items-center gap-2.5 px-4 py-2.5 md:py-3 rounded-lg text-xs md:text-sm font-bold transition-colors cursor-pointer whitespace-nowrap ${activeTab === 'profile' ? 'bg-[#EFF6FF] text-[#2563EB]' : 'text-[#475569] hover:bg-[#E2E8F0]'}`}
          >
            <Store className="w-4 h-4 md:w-5 md:h-5 shrink-0" />
            <span>بيانات النظام</span>
          </button>

          <button 
            onClick={() => setActiveTab('backup')}
            className={`flex-1 md:flex-initial md:w-full flex items-center gap-2.5 px-4 py-2.5 md:py-3 rounded-lg text-xs md:text-sm font-bold transition-colors cursor-pointer whitespace-nowrap ${activeTab === 'backup' ? 'bg-[#EFF6FF] text-[#2563EB]' : 'text-[#475569] hover:bg-[#E2E8F0]'}`}
          >
            <Database className="w-4 h-4 md:w-5 md:h-5 shrink-0" />
            <span>النسخ الاحتياطي والاستعادة</span>
          </button>
          
          <button 
            onClick={() => setActiveTab('appearance')}
            className={`flex-1 md:flex-initial md:w-full flex items-center gap-2.5 px-4 py-2.5 md:py-3 rounded-lg text-xs md:text-sm font-bold transition-colors cursor-pointer whitespace-nowrap ${activeTab === 'appearance' ? 'bg-[#EFF6FF] text-[#2563EB]' : 'text-[#475569] hover:bg-[#E2E8F0]'}`}
          >
            <Moon className="w-4 h-4 md:w-5 md:h-5 shrink-0" />
            <span>المظهر والوضع الداكن</span>
          </button>

          <button 
            onClick={() => setActiveTab('security')}
            className={`flex-1 md:flex-initial md:w-full flex items-center gap-2.5 px-4 py-2.5 md:py-3 rounded-lg text-xs md:text-sm font-bold transition-colors cursor-pointer whitespace-nowrap ${activeTab === 'security' ? 'bg-[#EFF6FF] text-[#2563EB]' : 'text-[#475569] hover:bg-[#E2E8F0]'}`}
          >
            <Lock className="w-4 h-4 md:w-5 md:h-5 shrink-0" />
            <span>تغيير كلمة المرور</span>
          </button>
        </div>

        {/* Setting Content */}
        <div className="flex-1 p-4 md:p-8">

          {activeTab === 'backup' && (
            <div className="max-w-4xl space-y-6">
              <div className="border-b border-[#E2E8F0] pb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold text-[#1E293B] flex items-center gap-2">
                    <Database className="w-5 h-5 text-[#2563EB]" />
                    <span>النسخ الاحتياطي الكامل والاستعادة</span>
                  </h3>
                  <p className="text-xs sm:text-sm text-[#475569] mt-1">
                    صدّر نسخة احتياطية شاملة لكل بيانات النظام (المخزون، الفئات، العملاء، الموردين، الفواتير، المشتريات، الإعدادات، والشعار) أو ارفع نسخة سابقة لاستعادتها بالكامل محلياً وسحابياً.
                  </p>
                </div>
                {lastBackupAt && (
                  <div className="bg-[#EFF6FF] border border-[#BFDBFE] text-[#1D4ED8] px-3 py-2 rounded-xl text-xs font-bold shrink-0">
                    آخر نسخة: <span dir="ltr">{new Date(lastBackupAt).toLocaleString('ar-EG')}</span>
                  </div>
                )}
              </div>

              {/* Current Live System Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-3 text-center">
                  <p className="text-[11px] font-bold text-[#64748B]">الأصناف</p>
                  <p className="text-xl font-black text-[#1E293B] mt-1">{inventory.length}</p>
                </div>
                <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-3 text-center">
                  <p className="text-[11px] font-bold text-[#64748B]">الفئات</p>
                  <p className="text-xl font-black text-[#1E293B] mt-1">{categories.length}</p>
                </div>
                <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-3 text-center">
                  <p className="text-[11px] font-bold text-[#64748B]">العملاء</p>
                  <p className="text-xl font-black text-[#1E293B] mt-1">{customers.length}</p>
                </div>
                <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-3 text-center">
                  <p className="text-[11px] font-bold text-[#64748B]">الموردون</p>
                  <p className="text-xl font-black text-[#1E293B] mt-1">{suppliers.length}</p>
                </div>
                <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-3 text-center">
                  <p className="text-[11px] font-bold text-[#64748B]">الفواتير</p>
                  <p className="text-xl font-black text-[#1E293B] mt-1">{invoices.length}</p>
                </div>
                <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-3 text-center">
                  <p className="text-[11px] font-bold text-[#64748B]">المشتريات</p>
                  <p className="text-xl font-black text-[#1E293B] mt-1">{purchases.length}</p>
                </div>
              </div>

              {/* Section 1: Export Full Backup */}
              <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-2xl p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div className="space-y-1">
                    <h4 className="font-bold text-base text-[#1E293B] flex items-center gap-2">
                      <Download className="w-5 h-5 text-[#10B981]" />
                      <span>1. تحميل نسخة احتياطية كاملة</span>
                    </h4>
                    <p className="text-xs text-[#64748B]">
                      يحفظ ملف JSON واحد يحتوي على كامل المخزون، الحسابات، الفواتير، عروض الأسعار، سجل السداد، الموردين، بيانات النظام والشعار، وإعدادات المظهر.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleDownloadBackup}
                    className="px-5 py-3 bg-[#10B981] hover:bg-[#059669] text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-sm transition-colors cursor-pointer shrink-0 border-none"
                  >
                    <Download className="w-4 h-4" />
                    <span>تصدير وتحميل النسخة الآن</span>
                  </button>
                </div>

                <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#475569] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={includePasswordInExport}
                    onChange={(e) => setIncludePasswordInExport(e.target.checked)}
                    className="w-4 h-4 rounded border-[#CBD5E1] text-[#2563EB]"
                  />
                  <span>تضمين كلمة مرور تسجيل الدخول الحالية داخل ملف النسخة الاحتياطية</span>
                </label>

                {exportSuccessMsg && (
                  <div className="p-3.5 bg-[#ECFDF5] border border-[#A7F3D0] rounded-xl text-xs font-bold text-[#047857] flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{exportSuccessMsg}</span>
                  </div>
                )}
              </div>

              {/* Section 2: Upload & Restore Backup */}
              <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-4">
                <div className="space-y-1">
                  <h4 className="font-bold text-base text-[#1E293B] flex items-center gap-2">
                    <FileUp className="w-5 h-5 text-[#2563EB]" />
                    <span>2. رفع واستعادة نسخة احتياطية</span>
                  </h4>
                  <p className="text-xs text-[#64748B]">
                    ارفع ملف النسخة الاحتياطية (<span dir="ltr">.json</span>) لمعاينة محتوياته أولاً، ثم ضبط جميع بيانات النظام وحفظها تلقائياً في السحابة.
                  </p>
                </div>

                <input
                  ref={backupFileInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleBackupFileInputChange}
                  className="hidden"
                />

                {/* Drag & Drop Zone */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDraggingBackup(true);
                  }}
                  onDragLeave={() => setIsDraggingBackup(false)}
                  onDrop={handleBackupDrop}
                  onClick={() => backupFileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-6 sm:p-8 text-center transition-all cursor-pointer ${
                    isDraggingBackup
                      ? 'border-[#2563EB] bg-[#EFF6FF]'
                      : 'border-[#CBD5E1] bg-[#F8FAFC] hover:border-[#2563EB] hover:bg-[#EFF6FF]/40'
                  }`}
                >
                  <div className="w-12 h-12 rounded-2xl bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center mx-auto mb-3">
                    <Upload className="w-6 h-6" />
                  </div>
                  <p className="font-bold text-sm text-[#1E293B]">
                    اسحب ملف النسخة الاحتياطية وأفلته هنا، أو اضغط لاختيار الملف
                  </p>
                  <p className="text-xs text-[#64748B] mt-1">
                    يدعم ملفات النسخ الاحتياطي بصيغة JSON (مثل <span dir="ltr">doctor-tools-backup-*.json</span>)
                  </p>
                </div>

                {/* Parse Error */}
                {backupParseError && (
                  <div className="p-4 bg-[#FEF2F2] border border-[#FECACA] rounded-xl text-xs font-bold text-[#DC2626] flex items-center gap-2.5">
                    <XCircle className="w-5 h-5 shrink-0" />
                    <span>{backupParseError}</span>
                  </div>
                )}

                {/* Restore Result Banner */}
                {restoreStatusBanner && (
                  <div
                    className={`p-4 rounded-xl border flex items-start gap-3 ${
                      restoreStatusBanner.type === 'success'
                        ? 'bg-[#ECFDF5] border-[#A7F3D0] text-[#047857]'
                        : restoreStatusBanner.type === 'warning'
                        ? 'bg-[#FFFBEB] border-[#FDE68A] text-[#B45309]'
                        : 'bg-[#FEF2F2] border-[#FECACA] text-[#DC2626]'
                    }`}
                  >
                    {restoreStatusBanner.type === 'success' ? (
                      <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
                    ) : restoreStatusBanner.type === 'warning' ? (
                      <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="w-5 h-5 shrink-0 mt-0.5" />
                    )}
                    <div className="space-y-1">
                      <p className="font-bold text-sm">{restoreStatusBanner.title}</p>
                      <p className="text-xs">{restoreStatusBanner.details}</p>
                    </div>
                  </div>
                )}

                {/* Backup Preview & Confirmation Panel */}
                {parsedBackup && (
                  <div className="bg-[#F8FAFC] border border-[#BFDBFE] rounded-2xl p-5 space-y-5">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-[#E2E8F0] pb-3">
                      <div>
                        <p className="text-sm font-black text-[#1E293B]">
                          معاينة النسخة المرفوعة: <span dir="ltr" className="text-[#2563EB]">{uploadedFileName}</span>
                        </p>
                        <p className="text-xs text-[#64748B] mt-0.5">
                          النشاط: <strong>{parsedBackup.data.businessProfile.name}</strong> • تاريخ النسخة:{' '}
                          <span dir="ltr">{new Date(parsedBackup.exportedAt).toLocaleString('ar-EG')}</span> • الحجم:{' '}
                          <span dir="ltr">{(uploadedFileSize / 1024).toFixed(1)} KB</span>
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setParsedBackup(null);
                          setUploadedFileName('');
                        }}
                        className="text-xs font-bold text-[#64748B] hover:text-[#DC2626] bg-transparent border-none cursor-pointer self-start sm:self-center"
                      >
                        إلغاء الملف
                      </button>
                    </div>

                    {/* Preview Counts */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
                      <div className="bg-white border border-[#E2E8F0] rounded-xl p-2.5 text-center">
                        <p className="text-[11px] font-bold text-[#64748B]">الأصناف</p>
                        <p className="text-lg font-black text-[#2563EB]">{parsedBackup.summary.inventoryCount}</p>
                      </div>
                      <div className="bg-white border border-[#E2E8F0] rounded-xl p-2.5 text-center">
                        <p className="text-[11px] font-bold text-[#64748B]">الفئات</p>
                        <p className="text-lg font-black text-[#2563EB]">{parsedBackup.summary.categoriesCount}</p>
                      </div>
                      <div className="bg-white border border-[#E2E8F0] rounded-xl p-2.5 text-center">
                        <p className="text-[11px] font-bold text-[#64748B]">العملاء</p>
                        <p className="text-lg font-black text-[#2563EB]">{parsedBackup.summary.customersCount}</p>
                      </div>
                      <div className="bg-white border border-[#E2E8F0] rounded-xl p-2.5 text-center">
                        <p className="text-[11px] font-bold text-[#64748B]">الموردون</p>
                        <p className="text-lg font-black text-[#2563EB]">{parsedBackup.summary.suppliersCount}</p>
                      </div>
                      <div className="bg-white border border-[#E2E8F0] rounded-xl p-2.5 text-center">
                        <p className="text-[11px] font-bold text-[#64748B]">الفواتير</p>
                        <p className="text-lg font-black text-[#2563EB]">{parsedBackup.summary.invoicesCount}</p>
                      </div>
                      <div className="bg-white border border-[#E2E8F0] rounded-xl p-2.5 text-center">
                        <p className="text-[11px] font-bold text-[#64748B]">المشتريات</p>
                        <p className="text-lg font-black text-[#2563EB]">{parsedBackup.summary.purchasesCount}</p>
                      </div>
                      <div className="bg-white border border-[#E2E8F0] rounded-xl p-2.5 text-center col-span-2 sm:col-span-1">
                        <p className="text-[11px] font-bold text-[#64748B]">الإشعارات</p>
                        <p className="text-lg font-black text-[#2563EB]">{parsedBackup.summary.notificationsCount}</p>
                      </div>
                    </div>

                    {/* Restore Mode Choice */}
                    <div className="space-y-2.5">
                      <label className="text-xs font-bold text-[#1E293B] block">اختر طريقة استعادة البيانات:</label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => setRestoreMode('replace')}
                          className={`p-4 rounded-xl border text-right transition-all cursor-pointer ${
                            restoreMode === 'replace'
                              ? 'border-[#2563EB] bg-[#EFF6FF] ring-2 ring-[#2563EB]/20'
                              : 'border-[#E2E8F0] bg-white hover:bg-[#F8FAFC]'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-bold text-sm text-[#1E293B] flex items-center gap-1.5">
                              <ShieldAlert className="w-4 h-4 text-[#2563EB]" />
                              <span>استعادة كاملة (استبدال شامل)</span>
                            </span>
                            {restoreMode === 'replace' && (
                              <span className="w-5 h-5 rounded-full bg-[#2563EB] text-white flex items-center justify-center">
                                <Check className="w-3 h-3 stroke-[3]" />
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-[#64748B]">
                            يضبط النظام بالكامل ليطابق النسخة المرفوعة 100% (يستبدل البيانات الحالية محلياً وفي السحابة).
                          </p>
                        </button>

                        <button
                          type="button"
                          onClick={() => setRestoreMode('merge')}
                          className={`p-4 rounded-xl border text-right transition-all cursor-pointer ${
                            restoreMode === 'merge'
                              ? 'border-[#2563EB] bg-[#EFF6FF] ring-2 ring-[#2563EB]/20'
                              : 'border-[#E2E8F0] bg-white hover:bg-[#F8FAFC]'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-bold text-sm text-[#1E293B] flex items-center gap-1.5">
                              <Layers className="w-4 h-4 text-[#10B981]" />
                              <span>دمج ذكي مع البيانات الحالية</span>
                            </span>
                            {restoreMode === 'merge' && (
                              <span className="w-5 h-5 rounded-full bg-[#2563EB] text-white flex items-center justify-center">
                                <Check className="w-3 h-3 stroke-[3]" />
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-[#64748B]">
                            يحافظ على البيانات الحالية ويضيف أو يحدّث السجلات الموجودة في النسخة الاحتياطية بدون حذف.
                          </p>
                        </button>
                      </div>
                    </div>

                    {/* Optional settings toggles */}
                    <div className="flex flex-wrap gap-4">
                      {parsedBackup.settings?.theme && (
                        <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#475569] cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={restoreThemeOpt}
                            onChange={(e) => setRestoreThemeOpt(e.target.checked)}
                            className="w-4 h-4 rounded border-[#CBD5E1] text-[#2563EB]"
                          />
                          <span>تطبيق إعدادات المظهر ({parsedBackup.settings.theme}) من النسخة</span>
                        </label>
                      )}
                      {parsedBackup.settings?.authPassword && (
                        <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#475569] cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={restorePasswordOpt}
                            onChange={(e) => setRestorePasswordOpt(e.target.checked)}
                            className="w-4 h-4 rounded border-[#CBD5E1] text-[#2563EB]"
                          />
                          <span>استعادة كلمة مرور الدخول من النسخة</span>
                        </label>
                      )}
                    </div>

                    {restoreMode === 'replace' && (
                      <div className="p-3 bg-[#FFFBEB] border border-[#FDE68A] rounded-xl text-xs text-[#B45309] flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>
                          تنبيه: وضع الاستبدال الشامل سيستبدل جميع البيانات الحالية في النظام ببيانات النسخة المرفوعة. يُفضّل تحميل نسخة احتياطية حالية أولاً إذا كنت تحتاج البيانات الموجودة الآن.
                        </span>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      <button
                        type="button"
                        onClick={handleConfirmRestore}
                        disabled={isRestoring}
                        className="px-6 py-3 bg-[#2563EB] hover:bg-[#1D4ED8] text-white rounded-xl font-bold text-sm flex items-center gap-2 shadow-sm transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed border-none"
                      >
                        <RefreshCw className={`w-4 h-4 ${isRestoring ? 'animate-spin' : ''}`} />
                        <span>{isRestoring ? 'جاري استعادة البيانات وضبط النظام...' : 'تأكيد واستعادة النسخة الآن'}</span>
                      </button>

                      <button
                        type="button"
                        disabled={isRestoring}
                        onClick={() => {
                          setParsedBackup(null);
                          setUploadedFileName('');
                        }}
                        className="px-4 py-3 bg-white border border-[#E2E8F0] hover:bg-[#F1F5F9] text-[#475569] rounded-xl font-bold text-sm transition-colors cursor-pointer disabled:opacity-60"
                      >
                        إلغاء
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          
          {activeTab === 'appearance' && (
            <div className="max-w-2xl space-y-6">
              <div className="border-b border-[#E2E8F0] pb-3">
                <h3 className="text-lg font-bold text-[#1E293B]">المظهر وإعدادات العرض</h3>
                <p className="text-xs sm:text-sm text-[#475569] mt-1">
                  خصص مظهر التطبيق وفعّل الوضع الداكن (Dark Mode) لحماية عينيك وتحسين تجربة الاستخدام في الإضاءة المنخفضة.
                </p>
              </div>

              {/* Quick Toggle Switch Banner */}
              <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-2xl p-4 sm:p-5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors shrink-0 ${isDarkMode ? 'bg-[#2563EB] text-white shadow-md' : 'bg-[#FEF3C7] text-[#D97706]'}`}>
                    {isDarkMode ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
                  </div>
                  <div>
                    <h4 className="font-bold text-sm sm:text-base text-[#1E293B]">الوضع الداكن (Dark Mode)</h4>
                    <p className="text-xs text-[#64748B] mt-0.5">
                      {isDarkMode ? 'الوضع الداكن مفعّل ومريح للعين' : 'الوضع الفاتح مفعّل حالياً'}
                    </p>
                  </div>
                </div>

                {/* Switch Toggle Button with rock-solid RTL-proof positioning */}
                <button
                  type="button"
                  onClick={toggleDarkMode}
                  dir="ltr"
                  role="switch"
                  aria-checked={isDarkMode}
                  aria-label="تبديل الوضع الداكن"
                  className={`relative inline-flex h-8 w-15 shrink-0 cursor-pointer rounded-full p-1 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:ring-offset-2 border-none ${
                    isDarkMode ? 'bg-[#2563EB]' : 'bg-[#CBD5E1]'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-flex h-6 w-6 transform items-center justify-center rounded-full bg-white shadow-md transition-transform duration-200 ease-in-out ${
                      isDarkMode ? 'translate-x-7' : 'translate-x-0'
                    }`}
                  >
                    {isDarkMode ? (
                      <Moon className="w-3.5 h-3.5 text-[#2563EB]" />
                    ) : (
                      <Sun className="w-3.5 h-3.5 text-[#F59E0B]" />
                    )}
                  </span>
                </button>
              </div>

              {/* Theme Mode Selection Cards */}
              <div className="space-y-3">
                <label className="text-sm font-bold text-[#1E293B] block">اختر نمط المظهر المفضل:</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  
                  {/* Light Mode Card */}
                  <button
                    type="button"
                    onClick={() => setTheme('light')}
                    className={`p-4 rounded-xl border text-right transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                      theme === 'light'
                        ? 'border-[#2563EB] bg-[#EFF6FF] shadow-xs ring-2 ring-[#2563EB]/20'
                        : 'border-[#E2E8F0] bg-white hover:bg-[#F8FAFC]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="w-9 h-9 rounded-lg bg-[#FEF3C7] text-[#D97706] flex items-center justify-center">
                        <Sun className="w-5 h-5" />
                      </div>
                      {theme === 'light' && (
                        <span className="w-5 h-5 rounded-full bg-[#2563EB] text-white flex items-center justify-center shadow-xs">
                          <Check className="w-3 h-3 stroke-[3]" />
                        </span>
                      )}
                    </div>
                    <div>
                      <p className="font-bold text-sm text-[#1E293B]">الوضع الفاتح</p>
                      <p className="text-xs text-[#64748B] mt-0.5">مظهر كلاسيكي ناصع وواضح</p>
                    </div>
                  </button>

                  {/* Dark Mode Card */}
                  <button
                    type="button"
                    onClick={() => setTheme('dark')}
                    className={`p-4 rounded-xl border text-right transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                      theme === 'dark'
                        ? 'border-[#2563EB] bg-[#1E293B] shadow-xs ring-2 ring-[#2563EB]/40'
                        : 'border-[#E2E8F0] bg-white hover:bg-[#F8FAFC]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="w-9 h-9 rounded-lg bg-[#0F172A] text-[#93C5FD] flex items-center justify-center border border-[#334155]">
                        <Moon className="w-5 h-5" />
                      </div>
                      {theme === 'dark' && (
                        <span className="w-5 h-5 rounded-full bg-[#2563EB] text-white flex items-center justify-center shadow-xs">
                          <Check className="w-3 h-3 stroke-[3]" />
                        </span>
                      )}
                    </div>
                    <div>
                      <p className={`font-bold text-sm ${theme === 'dark' ? 'text-white' : 'text-[#1E293B]'}`}>الوضع الداكن</p>
                      <p className={`text-xs mt-0.5 ${theme === 'dark' ? 'text-[#94A3B8]' : 'text-[#64748B]'}`}>مريح للعين وموفر للطاقة</p>
                    </div>
                  </button>

                  {/* System Default Card */}
                  <button
                    type="button"
                    onClick={() => setTheme('system')}
                    className={`p-4 rounded-xl border text-right transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                      theme === 'system'
                        ? 'border-[#2563EB] bg-[#EFF6FF] shadow-xs ring-2 ring-[#2563EB]/20'
                        : 'border-[#E2E8F0] bg-white hover:bg-[#F8FAFC]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="w-9 h-9 rounded-lg bg-[#F1F5F9] text-[#475569] flex items-center justify-center">
                        <Monitor className="w-5 h-5" />
                      </div>
                      {theme === 'system' && (
                        <span className="w-5 h-5 rounded-full bg-[#2563EB] text-white flex items-center justify-center shadow-xs">
                          <Check className="w-3 h-3 stroke-[3]" />
                        </span>
                      )}
                    </div>
                    <div>
                      <p className="font-bold text-sm text-[#1E293B]">حسب النظام</p>
                      <p className="text-xs text-[#64748B] mt-0.5">يتزامن تلقائياً مع جهازك</p>
                    </div>
                  </button>
                </div>
              </div>

              {/* Note about Print Mode */}
              <div className="p-3.5 bg-[#F0FDF4] border border-[#BBF7D0] rounded-xl text-xs text-[#16A34A] flex items-center gap-2">
                <Printer className="w-4 h-4 shrink-0 text-[#16A34A]" />
                <span>
                  <strong>ملاحظة هامة:</strong> فواتير الطباعة وتقارير الحسابات تظل دائماً بأعلى درجات الوضوح واللون الأبيض القياسي للطباعة حتى عند تفعيل الوضع الداكن.
                </span>
              </div>
            </div>
          )}
          
          {activeTab === 'profile' && (
            <div className="max-w-xl">
               <h3 className="text-lg font-bold text-[#1E293B] mb-6 border-b border-[#E2E8F0] pb-2">تفاصيل واسم النظام</h3>
               <form onSubmit={handleProfileSubmit} className="space-y-5">
                  <div className="space-y-1">
                    <label className="text-sm font-bold text-[#475569]">اسم النظام</label>
                    <input 
                      type="text" required
                      value={profile.businessName}
                      onChange={e => setProfile({...profile, businessName: e.target.value})}
                      className="w-full border border-[#E2E8F0] rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-[#2563EB] focus:outline-none" 
                    />
                  </div>
                  
                  <div className="space-y-1">
                    <label className="text-sm font-bold text-[#475569]">رقم هاتف النظام للتواصل (اختياري)</label>
                    <input 
                      type="tel"
                      value={profile.phone}
                      onChange={e => setProfile({...profile, phone: e.target.value})}
                      placeholder="أدخل رقم الهاتف أو اتركه فارغاً..."
                      className="w-full border border-[#E2E8F0] rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-[#2563EB] focus:outline-none" 
                      dir="ltr"
                    />
                  </div>
                  
                  <div className="space-y-1">
                    <label className="text-sm font-bold text-[#475569]">العنوان</label>
                    <input 
                      type="text" required
                      value={profile.address}
                      onChange={e => setProfile({...profile, address: e.target.value})}
                      className="w-full border border-[#E2E8F0] rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-[#2563EB] focus:outline-none" 
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-sm font-bold text-[#475569]">السلوجان / وصف النظام (يظهر في صفحة تسجيل الدخول)</label>
                    <input 
                      type="text" required
                      value={profile.description}
                      onChange={e => setProfile({...profile, description: e.target.value})}
                      className="w-full border border-[#E2E8F0] rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-[#2563EB] focus:outline-none" 
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-sm font-bold text-[#475569]">الشعار (اللوجو)</label>
                    <div className="mt-2 flex items-center gap-4">
                      {profile.logo ? (
                        <div className="w-16 h-16 rounded-xl border border-[#E2E8F0] overflow-hidden flex items-center justify-center bg-white">
                          <img src={profile.logo} alt="Logo" className="w-full h-full object-contain" />
                        </div>
                      ) : (
                        <div className="w-16 h-16 rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] flex flex-col justify-center items-center text-[#94A3B8]">
                           <Store className="w-6 h-6" />
                        </div>
                      )}
                      
                      <input 
                        type="file" 
                        ref={fileInputRef} 
                        onChange={handleLogoChange} 
                        accept="image/*" 
                        className="hidden" 
                      />
                      
                      <button 
                        type="button" 
                        onClick={() => fileInputRef.current?.click()}
                        className="px-4 py-2 flex items-center gap-2 bg-white border border-[#E2E8F0] rounded-lg text-sm font-bold text-[#475569] hover:bg-[#F8FAFC]"
                      >
                        <Upload className="w-4 h-4" />
                        تغيير اللوجو
                      </button>
                      
                      {profile.logo && (
                        <button 
                          type="button" 
                          onClick={() => setProfile(prev => ({ ...prev, logo: null }))}
                          className="px-4 py-2 text-sm font-bold text-[#DC2626] hover:bg-[#FEF2F2] rounded-lg transition-colors border border-transparent hover:border-[#FECACA]"
                        >
                          إزالة
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="pt-6">
                    <button type="submit" className="flex items-center gap-2 px-6 py-2 bg-[#2563EB] text-white rounded-lg font-bold hover:bg-[#1D4ED8] transition-colors">
                      <Save className="w-4 h-4" />
                      حفظ التغييرات
                    </button>
                  </div>
               </form>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="max-w-xl">
               <h3 className="text-lg font-bold text-[#1E293B] mb-6 border-b border-[#E2E8F0] pb-2">كلمة المرور والأمان</h3>
               <form onSubmit={handleSecuritySubmit} className="space-y-5">
                  <div className="space-y-1">
                    <label className="text-sm font-bold text-[#475569]">كلمة المرور الحالية</label>
                    <input 
                      type="password" required
                      value={security.currentPassword}
                      onChange={e => setSecurity({...security, currentPassword: e.target.value})}
                      className="w-full border border-[#E2E8F0] rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-[#2563EB] focus:outline-none" 
                      dir="ltr"
                    />
                  </div>
                  
                  <div className="space-y-1">
                    <label className="text-sm font-bold text-[#475569]">كلمة المرور الجديدة</label>
                    <input 
                      type="password" required minLength={6}
                      value={security.newPassword}
                      onChange={e => setSecurity({...security, newPassword: e.target.value})}
                      className="w-full border border-[#E2E8F0] rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-[#2563EB] focus:outline-none" 
                      dir="ltr"
                    />
                  </div>
                  
                  <div className="space-y-1">
                    <label className="text-sm font-bold text-[#475569]">تأكيد كلمة المرور الجديدة</label>
                    <input 
                      type="password" required minLength={6}
                      value={security.confirmPassword}
                      onChange={e => setSecurity({...security, confirmPassword: e.target.value})}
                      className="w-full border border-[#E2E8F0] rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-[#2563EB] focus:outline-none" 
                      dir="ltr"
                    />
                  </div>

                  <div className="pt-6">
                    <button type="submit" className="flex items-center gap-2 px-6 py-2 bg-[#2563EB] text-white rounded-lg font-bold hover:bg-[#1D4ED8] transition-colors">
                      <Save className="w-4 h-4" />
                      تحديث كلمة المرور
                    </button>
                  </div>
               </form>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
