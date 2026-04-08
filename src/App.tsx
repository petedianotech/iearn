import { useEffect, useState } from 'react';
import { auth, db } from './firebase';
import { 
  signInAnonymously, 
  onAuthStateChanged, 
  User as FirebaseUser,
  signOut
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  collection, 
  onSnapshot, 
  query, 
  where, 
  addDoc, 
  updateDoc, 
  increment,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { 
  Home, 
  ClipboardList, 
  Wallet, 
  User as UserIcon, 
  Coins, 
  Megaphone,
  ArrowUp,
  LogOut,
  Loader2,
  Download,
  Trophy
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Types
interface UserProfile {
  displayName: string;
  email: string;
  balance: number;
  dailyEarnings: number;
  lastBonusAt?: Timestamp;
  role: 'user' | 'admin';
}

interface Task {
  id: string;
  title: string;
  description: string;
  reward: number;
  type: 'survey' | 'game' | 'ad' | 'bonus';
  color: string;
}

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('home');
  const [actionLoading, setActionLoading] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [isNative, setIsNative] = useState(false);

  const [leaderboard, setLeaderboard] = useState<UserProfile[]>([]);

  useEffect(() => {
    // Check if running in Capacitor
    const checkNative = async () => {
      if (window.hasOwnProperty('Capacitor')) {
        setIsNative(true);
      }
    };
    checkNative();

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      // Only show install prompt if not already installed as PWA or native app
      if (!window.matchMedia('(display-mode: standalone)').matches && !isNative) {
        setShowInstallPrompt(true);
      }
    });
  }, [isNative]);

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
        setShowInstallPrompt(false);
      }
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Check if profile exists, create if not
        const userRef = doc(db, 'users', currentUser.uid);
        const userSnap = await getDoc(userRef);
        
        if (!userSnap.exists()) {
          const newProfile: UserProfile = {
            displayName: `Guest_${Math.floor(Math.random() * 10000)}`,
            email: '',
            balance: 0,
            dailyEarnings: 0,
            role: 'user'
          };
          await setDoc(userRef, newProfile);
          setProfile(newProfile);
        } else {
          setProfile(userSnap.data() as UserProfile);
        }
        
        // Listen to profile changes
        const unsubProfile = onSnapshot(userRef, (doc) => {
          if (doc.exists()) {
            setProfile(doc.data() as UserProfile);
          }
        });

        // Listen to tasks
        const tasksRef = collection(db, 'tasks');
        const unsubTasks = onSnapshot(tasksRef, (snapshot) => {
          const taskData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Task));
          setTasks(taskData);
          
          // Seed tasks if empty (for demo purposes)
          if (taskData.length === 0) {
            seedTasks();
          }
        });

        // Listen to leaderboard
        const leaderboardRef = query(collection(db, 'users'), where('balance', '>', 0));
        const unsubLeaderboard = onSnapshot(leaderboardRef, (snapshot) => {
          const users = snapshot.docs.map(doc => doc.data() as UserProfile);
          // Sort client-side to avoid needing a composite index immediately
          users.sort((a, b) => b.balance - a.balance);
          setLeaderboard(users.slice(0, 10));
        });

        setLoading(false);
        return () => {
          unsubProfile();
          unsubTasks();
          unsubLeaderboard();
        };
      } else {
        // Auto login anonymously if not logged in
        signInAnonymously(auth).catch(error => {
          console.error("Error signing in anonymously:", error);
          setLoading(false);
        });
      }
    });

    return () => unsubscribe();
  }, []);

  const seedTasks = async () => {
    const defaultTasks = [
      {
        title: 'Review Local Shop',
        description: 'Blantyre Market Survey',
        reward: 750,
        type: 'survey',
        color: 'border-green-500'
      },
      {
        title: 'Play "Snake Gold"',
        description: 'Reach Level 10',
        reward: 1200,
        type: 'game',
        color: 'border-yellow-500'
      },
      {
        title: 'Watch Video Ad',
        description: 'Watch a 30-second video',
        reward: 50,
        type: 'ad',
        color: 'border-blue-500'
      },
      {
        title: 'Follow on Twitter',
        description: 'Follow our official page',
        reward: 150,
        type: 'bonus',
        color: 'border-purple-500'
      },
      {
        title: 'Complete Profile',
        description: 'Add your phone number',
        reward: 300,
        type: 'survey',
        color: 'border-orange-500'
      }
    ];
    
    for (const task of defaultTasks) {
      await addDoc(collection(db, 'tasks'), task);
    }
  };

  const handleLogout = async () => {
    // With anonymous auth, logging out will lose the account unless linked.
    // For this open app, we can just clear local state or sign out.
    if (window.confirm("Logging out of a guest account will lose your progress. Are you sure?")) {
      await signOut(auth);
      window.location.reload();
    }
  };

  const handleDailyBonus = async () => {
    if (!user || !profile || actionLoading) return;
    
    // Check if 24 hours have passed
    const now = new Date();
    if (profile.lastBonusAt) {
      const lastBonus = profile.lastBonusAt.toDate();
      const diffHours = Math.abs(now.getTime() - lastBonus.getTime()) / 36e5;
      if (diffHours < 24) {
        alert(`You already claimed your daily bonus! Come back in ${Math.ceil(24 - diffHours)} hours.`);
        return;
      }
    }

    setActionLoading(true);
    try {
      const reward = 250;
      await addDoc(collection(db, 'userTasks'), {
        userId: user.uid,
        taskId: 'daily_bonus',
        reward,
        completedAt: serverTimestamp()
      });

      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        balance: increment(reward),
        dailyEarnings: increment(reward),
        lastBonusAt: serverTimestamp()
      });
      alert(`You claimed your daily bonus of MWK ${reward}!`);
    } catch (error) {
      console.error('Bonus error:', error);
      alert('Failed to claim bonus.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleTaskComplete = async (taskId: string, reward: number) => {
    if (!user || !profile || actionLoading) return;
    
    setActionLoading(true);
    try {
      // Create user task record
      await addDoc(collection(db, 'userTasks'), {
        userId: user.uid,
        taskId,
        reward,
        completedAt: serverTimestamp()
      });

      // Update user balance
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        balance: increment(reward),
        dailyEarnings: increment(reward)
      });
      
      // We don't need to alert, the UI will update optimistically via snapshot
    } catch (error) {
      console.error('Task error:', error);
      alert('Failed to complete task.');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading || !user || !profile) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div className="w-20 h-20 bg-blue-600 rounded-2xl mx-auto flex items-center justify-center mb-6 shadow-lg shadow-blue-200 animate-pulse">
          <span className="text-4xl font-black italic text-white">ie</span>
        </div>
        <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-4" />
        <p className="text-gray-500 font-medium">Loading your account...</p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto bg-gray-50 min-h-screen font-sans pb-24 relative shadow-2xl overflow-hidden">
      {showInstallPrompt && (
        <div className="fixed top-4 left-4 right-4 bg-blue-600 text-white p-4 rounded-2xl shadow-lg z-[100] flex items-center justify-between">
          <div>
            <p className="font-bold">Install Iearn</p>
            <p className="text-sm opacity-90">It's only 1MB!</p>
          </div>
          <button onClick={handleInstall} className="bg-white text-blue-600 font-bold px-4 py-2 rounded-xl text-sm">
            Install
          </button>
        </div>
      )}
      
      {/* Header & Balance Card */}
      <div className="bg-blue-700 p-6 rounded-b-3xl shadow-lg text-white relative overflow-hidden">
        {/* Decorative background circles */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-white opacity-5 rounded-full -mr-10 -mt-10"></div>
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-white opacity-5 rounded-full -ml-10 -mb-10"></div>
        
        <div className="flex justify-between items-center mb-6 relative z-10">
          <h1 className="text-2xl font-black italic tracking-tight">Iearn</h1>
          <div className="flex items-center gap-2">
            <div className="bg-blue-600/50 backdrop-blur-sm px-3 py-1.5 rounded-full text-xs font-medium border border-blue-500/30">
              ID: {user.uid.substring(0, 6).toUpperCase()}
            </div>
            <button onClick={handleLogout} className="p-1.5 bg-blue-600/50 rounded-full hover:bg-blue-600 transition-colors">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
        
        <div className="relative z-10">
          <p className="text-blue-200 text-sm font-medium mb-1">Current Balance</p>
          <div className="flex items-end gap-3">
            <h2 className="text-4xl font-black tracking-tight">MWK {profile.balance.toLocaleString()}</h2>
            <div className="flex items-center text-green-300 text-sm font-bold mb-1.5 bg-green-900/20 px-2 py-0.5 rounded-full">
              <ArrowUp className="w-3 h-3 mr-0.5" />
              +{profile.dailyEarnings.toLocaleString()} today
            </div>
          </div>
        </div>
      </div>

      {/* Quick Action Grid */}
      <div className="px-4 grid grid-cols-2 gap-4 -mt-6 relative z-20">
        <button 
          onClick={handleDailyBonus}
          disabled={actionLoading}
          className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center hover:shadow-md transition-all active:scale-95 disabled:opacity-70"
        >
          <div className="bg-yellow-100 p-3.5 rounded-full mb-3 shadow-inner">
            <Coins className="w-6 h-6 text-yellow-600" />
          </div>
          <span className="font-bold text-gray-700 text-sm">Daily Bonus</span>
        </button>
        <button 
          onClick={() => handleTaskComplete('watch_ad', 50)}
          disabled={actionLoading}
          className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center hover:shadow-md transition-all active:scale-95 disabled:opacity-70"
        >
          <div className="bg-blue-100 p-3.5 rounded-full mb-3 shadow-inner">
            <Megaphone className="w-6 h-6 text-blue-600" />
          </div>
          <span className="font-bold text-gray-700 text-sm">Watch Ads</span>
        </button>
      </div>

      {/* Main Content Area based on Tab */}
      {activeTab === 'home' && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
          {/* Task List Section */}
          <div className="p-5 mt-2">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-gray-800 text-lg">Available Tasks</h3>
              <button className="text-blue-600 text-sm font-semibold hover:underline">View All</button>
            </div>

            {tasks.length === 0 ? (
              <div className="text-center py-8 bg-white rounded-xl border border-gray-100 border-dashed">
                <p className="text-gray-500 text-sm">No tasks available right now.</p>
              </div>
            ) : (
              tasks.map(task => (
                <div key={task.id} className={cn("bg-white p-4 rounded-xl shadow-sm mb-3 flex justify-between items-center border-l-4 transition-all hover:shadow-md", task.color || "border-blue-500")}>
                  <div>
                    <p className="font-bold text-gray-800">{task.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{task.description}</p>
                  </div>
                  <div className="text-right flex flex-col items-end">
                    <p className="text-green-600 font-bold">MWK {task.reward.toLocaleString()}</p>
                    <button 
                      onClick={() => handleTaskComplete(task.id, task.reward)}
                      disabled={actionLoading}
                      className="bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10px] font-bold px-3 py-1.5 rounded-md mt-2 transition-colors active:scale-95 disabled:opacity-50"
                    >
                      Start Now
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Mobile Money Payout Preview */}
          <div className="p-5 mx-4 bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl border border-green-100 shadow-sm">
            <p className="text-green-800 font-bold text-sm mb-3">Cash Out Options:</p>
            <div className="flex gap-3">
              <div className="flex-1 flex items-center justify-center gap-2 bg-white px-3 py-2.5 rounded-xl text-xs font-bold shadow-sm border border-gray-50">
                <div className="w-3 h-3 bg-red-600 rounded-full shadow-inner"></div> 
                Airtel Money
              </div>
              <div className="flex-1 flex items-center justify-center gap-2 bg-white px-3 py-2.5 rounded-xl text-xs font-bold shadow-sm border border-gray-50">
                <div className="w-3 h-3 bg-yellow-400 rounded-full shadow-inner"></div> 
                TNM Mpamba
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'tasks' && (
        <div className="p-5 mt-2 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <h2 className="text-xl font-bold text-gray-800 mb-4">All Tasks</h2>
          <div className="bg-white rounded-xl p-8 text-center border border-gray-100 shadow-sm">
            <ClipboardList className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">More tasks coming soon!</p>
          </div>
        </div>
      )}

      {activeTab === 'wallet' && (
        <div className="p-5 mt-2 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <h2 className="text-xl font-bold text-gray-800 mb-4">Wallet & Payouts</h2>
          <div className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm mb-4">
            <p className="text-gray-500 text-sm font-medium mb-1">Available to Withdraw</p>
            <h3 className="text-3xl font-black text-gray-900 mb-4">MWK {profile.balance.toLocaleString()}</h3>
            
            <div className="space-y-3">
              <button className="w-full bg-red-50 hover:bg-red-100 text-red-700 font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-colors">
                <div className="w-4 h-4 bg-red-600 rounded-full"></div>
                Withdraw to Airtel Money
              </button>
              <button className="w-full bg-yellow-50 hover:bg-yellow-100 text-yellow-700 font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-colors">
                <div className="w-4 h-4 bg-yellow-400 rounded-full"></div>
                Withdraw to TNM Mpamba
              </button>
            </div>
          </div>

          {/* Postback Info for Offer Walls */}
          <div className="bg-blue-50 rounded-xl p-5 border border-blue-100 shadow-sm">
            <h4 className="font-bold text-blue-900 text-sm mb-2 flex items-center gap-2">
              <Megaphone className="w-4 h-4" />
              Developer: Postback URL
            </h4>
            <p className="text-xs text-blue-700 mb-3">
              Use this URL in your Offer Wall dashboard (CPALead, etc.) to credit users automatically.
            </p>
            <div className="bg-white p-3 rounded-lg border border-blue-200 text-[10px] font-mono break-all text-gray-600 select-all">
              {(import.meta.env.VITE_APP_URL || window.location.origin)}/api/postback?userId={user.uid}&reward=REWARD_AMOUNT&secret=YOUR_SECRET
            </div>
            <p className="text-[10px] text-blue-600 mt-2 italic">
              * Replace REWARD_AMOUNT with the network's reward variable.
            </p>
          </div>
        </div>
      )}

      {activeTab === 'leaderboard' && (
        <div className="p-5 mt-2 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            <Trophy className="w-6 h-6 text-yellow-500" />
            Top Earners
          </h2>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            {leaderboard.length === 0 ? (
              <div className="p-6 text-center text-gray-500">No earners yet. Be the first!</div>
            ) : (
              leaderboard.map((lUser, index) => (
                <div key={index} className="flex items-center justify-between p-4 border-b border-gray-50 last:border-0">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm",
                      index === 0 ? "bg-yellow-100 text-yellow-700" : 
                      index === 1 ? "bg-gray-200 text-gray-700" : 
                      index === 2 ? "bg-orange-100 text-orange-700" : "bg-blue-50 text-blue-600"
                    )}>
                      {index + 1}
                    </div>
                    <div>
                      <p className="font-bold text-gray-800 text-sm">{lUser.displayName}</p>
                      {lUser.displayName === profile.displayName && <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">You</span>}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-green-600 text-sm">MWK {lUser.balance.toLocaleString()}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'profile' && (
        <div className="p-5 mt-2 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <h2 className="text-xl font-bold text-gray-800 mb-4">My Profile</h2>
          <div className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-xl">
                {profile.displayName.charAt(0).toUpperCase()}
              </div>
              <div>
                <h3 className="font-bold text-gray-900 text-lg">{profile.displayName}</h3>
                <p className="text-gray-500 text-sm">{profile.email}</p>
              </div>
            </div>
            
            <div className="border-t border-gray-100 pt-4">
              <div className="flex justify-between py-2">
                <span className="text-gray-500">Account ID</span>
                <span className="font-medium text-gray-900">{user.uid.substring(0, 8)}</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-gray-500">Total Earned</span>
                <span className="font-medium text-green-600">MWK {profile.balance.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Navigation Bar */}
      <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white border-t border-gray-200 p-2 flex justify-around items-center pb-safe shadow-[0_-4px_20px_rgba(0,0,0,0.05)] z-50">
        <button 
          onClick={() => setActiveTab('home')}
          className={cn("flex flex-col items-center p-2 rounded-xl transition-all w-16", activeTab === 'home' ? "text-blue-600" : "text-gray-400 hover:text-gray-600")}
        >
          <Home className={cn("w-6 h-6 mb-1", activeTab === 'home' && "fill-blue-50")} />
          <span className="text-[10px] font-bold">Home</span>
        </button>
        <button 
          onClick={() => setActiveTab('tasks')}
          className={cn("flex flex-col items-center p-2 rounded-xl transition-all w-16", activeTab === 'tasks' ? "text-blue-600" : "text-gray-400 hover:text-gray-600")}
        >
          <ClipboardList className={cn("w-6 h-6 mb-1", activeTab === 'tasks' && "fill-blue-50")} />
          <span className="text-[10px] font-bold">Tasks</span>
        </button>
        <button 
          onClick={() => setActiveTab('wallet')}
          className={cn("flex flex-col items-center p-2 rounded-xl transition-all w-16", activeTab === 'wallet' ? "text-blue-600" : "text-gray-400 hover:text-gray-600")}
        >
          <Wallet className={cn("w-6 h-6 mb-1", activeTab === 'wallet' && "fill-blue-50")} />
          <span className="text-[10px] font-bold">Wallet</span>
        </button>
        <button 
          onClick={() => setActiveTab('leaderboard')}
          className={cn("flex flex-col items-center p-2 rounded-xl transition-all w-16", activeTab === 'leaderboard' ? "text-blue-600" : "text-gray-400 hover:text-gray-600")}
        >
          <Trophy className={cn("w-6 h-6 mb-1", activeTab === 'leaderboard' && "fill-blue-50")} />
          <span className="text-[10px] font-bold">Top</span>
        </button>
        <button 
          onClick={() => setActiveTab('profile')}
          className={cn("flex flex-col items-center p-2 rounded-xl transition-all w-16", activeTab === 'profile' ? "text-blue-600" : "text-gray-400 hover:text-gray-600")}
        >
          <UserIcon className={cn("w-6 h-6 mb-1", activeTab === 'profile' && "fill-blue-50")} />
          <span className="text-[10px] font-bold">Profile</span>
        </button>
      </div>
    </div>
  );
}
